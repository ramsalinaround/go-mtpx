package main

// WebSocket per docs/spec/02-api-contract.md: wss://…/v1/ws?token=<access_token>,
// frames {type, data, client_id?}, server ping every 30s.

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type wsConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *wsConn) send(v any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return c.conn.WriteJSON(v)
}

type Hub struct {
	mu    sync.Mutex
	conns map[string][]*wsConn // uid -> connections
}

func NewHub() *Hub { return &Hub{conns: map[string][]*wsConn{}} }

func (h *Hub) add(uid string, c *wsConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[uid] = append(h.conns[uid], c)
}

func (h *Hub) remove(uid string, c *wsConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	var kept []*wsConn
	for _, x := range h.conns[uid] {
		if x != c {
			kept = append(kept, x)
		}
	}
	if len(kept) == 0 {
		delete(h.conns, uid)
	} else {
		h.conns[uid] = kept
	}
}

// Deliver sends a frame to every connection of a user. Safe without store.mu.
func (h *Hub) Deliver(uid, frameType string, data any) {
	h.mu.Lock()
	conns := append([]*wsConn(nil), h.conns[uid]...)
	h.mu.Unlock()
	frame := map[string]any{"type": frameType, "data": data}
	for _, c := range conns {
		if err := c.send(frame); err != nil {
			_ = c.conn.Close()
		}
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // same-origin in practice; prototype server
}

type inboundFrame struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func serveWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	store.mu.Lock()
	rec, ok := store.access[token]
	valid := ok && time.Now().Before(rec.ExpiresAt) && store.users[rec.UserID] != nil
	uid := rec.UserID
	store.mu.Unlock()
	if !valid {
		writeErr(w, errOf(401, "token_expired", "Missing or expired token"))
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	c := &wsConn{conn: conn}
	hub.add(uid, c)
	defer func() {
		hub.remove(uid, c)
		_ = conn.Close()
	}()

	// heartbeat: server pings every 30s (contract); close on write failure
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				if err := c.send(map[string]any{"type": "ping"}); err != nil {
					return
				}
			case <-stop:
				return
			}
		}
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var f inboundFrame
		if json.Unmarshal(raw, &f) != nil {
			continue
		}
		switch f.Type {
		case "pong":
			// heartbeat reply; nothing to do
		case "message.send":
			var d struct {
				MatchID  string `json:"match_id"`
				Body     string `json:"body"`
				ClientID string `json:"client_id"`
			}
			if json.Unmarshal(f.Data, &d) != nil {
				continue
			}
			store.mu.Lock()
			u := store.users[uid]
			if u != nil {
				_, _ = sendMessage(u, d.MatchID, d.Body, d.ClientID)
			}
			store.mu.Unlock()
		case "message.read":
			var d struct {
				MatchID       string `json:"match_id"`
				LastMessageID string `json:"last_message_id"`
			}
			if json.Unmarshal(f.Data, &d) != nil {
				continue
			}
			store.mu.Lock()
			if m := store.matches[d.MatchID]; m != nil && (m.Users[0] == uid || m.Users[1] == uid) {
				m.Unread[uid] = 0
				for _, x := range m.Msgs {
					if x.ID == d.LastMessageID {
						m.LastRead[uid] = x.Seq
					}
				}
			}
			store.mu.Unlock()
		}
	}
}
