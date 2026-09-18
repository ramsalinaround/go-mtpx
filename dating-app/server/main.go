package main

// Maktub reference backend — implements docs/spec/02-api-contract.md over real
// HTTP + WebSocket and serves the web client. Run from dating-app/server:
//   go run .            (listens on :8787, serves ../ as the client)
// Flags/env: -addr, -static; PORT overrides the port.

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var store = NewStore()
var hub = NewHub()

type apiErr struct {
	status     int
	code, msg  string
	retryAfter int
}

func (e *apiErr) Error() string { return e.code + ": " + e.msg }

func errOf(status int, code, msg string) *apiErr {
	return &apiErr{status: status, code: code, msg: msg}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func writeErr(w http.ResponseWriter, e *apiErr) {
	body := map[string]any{"code": e.code, "message": e.msg}
	if e.retryAfter > 0 {
		body["retry_after_s"] = e.retryAfter
	}
	writeJSON(w, e.status, map[string]any{"error": body})
}

func decode(r *http.Request, v any) *apiErr {
	if r.Body == nil {
		return errOf(400, "validation_failed", "JSON body required")
	}
	if err := json.NewDecoder(r.Body).Decode(v); err != nil && err != io.EOF {
		return errOf(400, "validation_failed", "Malformed JSON body")
	}
	return nil
}

// authUser resolves the bearer token; call with store.mu held.
func authUser(r *http.Request) (*User, *apiErr) {
	h := r.Header.Get("Authorization")
	token := strings.TrimPrefix(h, "Bearer ")
	if token == "" || token == h {
		return nil, errOf(401, "token_expired", "Missing bearer token")
	}
	rec, ok := store.access[token]
	if !ok {
		return nil, errOf(401, "token_expired", "Unknown access token")
	}
	if time.Now().After(rec.ExpiresAt) {
		return nil, errOf(401, "token_expired", "Access token expired")
	}
	u := store.users[rec.UserID]
	if u == nil {
		return nil, errOf(401, "token_expired", "Account no longer exists")
	}
	return u, nil
}

// handler wraps a route body with locking and envelope error writing.
func handler(fn func(w http.ResponseWriter, r *http.Request) *apiErr) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		store.mu.Lock()
		defer store.mu.Unlock()
		if e := fn(w, r); e != nil {
			writeErr(w, e)
		}
	}
}

var e164 = regexp.MustCompile(`^\+[1-9]\d{7,14}$`)

/* ---------------- bot + moderation engines (async; take the lock themselves) ---------------- */

func scheduleModeration(uid, photoID string) {
	time.AfterFunc(moderationMS*time.Millisecond, func() {
		store.mu.Lock()
		defer store.mu.Unlock()
		u := store.users[uid]
		if u == nil {
			return
		}
		for _, p := range u.Photos {
			if p.ID == photoID && p.Status == "pending" {
				if p.Kind == "lowlight" {
					p.Status = "rejected"
					p.Reason = "Too dark to verify"
				} else {
					p.Status = "approved"
				}
			}
		}
	})
}

func botRespond(matchID, botID, userID string) {
	delay := 1300 + time.Duration(len(matchID)%7)*100
	time.AfterFunc(delay*time.Millisecond, func() {
		store.mu.Lock()
		m := store.matches[matchID]
		bot := store.users[botID]
		if m == nil || bot == nil || m.Closed != "" || store.users[userID] == nil {
			store.mu.Unlock()
			return
		}
		used := 0
		for _, x := range m.Msgs {
			if x.SenderID == botID {
				used++
			}
		}
		line := bot.Replies[used%len(bot.Replies)]
		reply := store.pushMessage(m, botID, line, "")
		frame := serializeMessage(reply, m.ID)
		store.mu.Unlock()
		hub.Deliver(userID, "message.new", frame)

		time.AfterFunc(300*time.Millisecond, func() {
			store.mu.Lock()
			m := store.matches[matchID]
			if m == nil || m.Closed != "" {
				store.mu.Unlock()
				return
			}
			var lastMine *Message
			for _, x := range m.Msgs {
				if x.SenderID == userID {
					lastMine = x
				}
			}
			if lastMine == nil {
				store.mu.Unlock()
				return
			}
			m.LastRead[botID] = lastMine.Seq
			m.Unread[botID] = 0
			data := map[string]any{"match_id": m.ID, "last_message_id": lastMine.ID, "reader_id": botID}
			store.mu.Unlock()
			hub.Deliver(userID, "message.read", data)
		})
	})
}

// sendMessage is shared by the WS frame and the REST fallback; call with lock held.
func sendMessage(u *User, matchID, body, clientID string) (*Message, *apiErr) {
	m := store.matches[matchID]
	if m == nil || (m.Users[0] != u.ID && m.Users[1] != u.ID) {
		return nil, errOf(404, "not_found", "No such match")
	}
	if m.Closed != "" {
		return nil, errOf(409, "match_closed", "This conversation has ended")
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, errOf(400, "validation_failed", "Message body required")
	}
	msg := store.pushMessage(m, u.ID, body, clientID)
	frame := serializeMessage(msg, m.ID)
	partnerID := m.partnerOf(u.ID)
	go hub.Deliver(u.ID, "message.new", frame)
	go hub.Deliver(partnerID, "message.new", frame)
	if p := store.users[partnerID]; p != nil && p.Bot {
		go botRespond(m.ID, partnerID, u.ID)
	}
	return msg, nil
}

// closeMatch marks a match closed and notifies both sides; call with lock held.
func closeMatch(m *Match, reason string) {
	if m.Closed != "" {
		return
	}
	m.Closed = reason
	data := map[string]any{"match_id": m.ID, "reason": reason}
	for _, uid := range m.Users {
		go hub.Deliver(uid, "match.closed", data)
	}
}

/* ---------------- routes ---------------- */

func main() {
	addr := flag.String("addr", ":8787", "listen address")
	static := flag.String("static", "..", "directory holding the web client")
	flag.Parse()
	if p := os.Getenv("PORT"); p != "" {
		*addr = ":" + p
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /v1/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "service": "maktub", "contract": "v1"})
	})

	mux.HandleFunc("POST /v1/otp/request", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		var b struct {
			Phone string `json:"phone"`
		}
		if e := decode(r, &b); e != nil {
			return e
		}
		if !e164.MatchString(b.Phone) {
			return errOf(400, "validation_failed", "Phone must be E.164, like +13035551234")
		}
		now := time.Now()
		sent := store.otpSent[b.Phone]
		kept := sent[:0]
		for _, t := range sent {
			if now.Sub(t) < time.Minute {
				kept = append(kept, t)
			}
		}
		if len(kept) >= 3 {
			retry := int(time.Minute.Seconds() - now.Sub(kept[0]).Seconds())
			if retry < 1 {
				retry = 1
			}
			return &apiErr{status: 429, code: "otp_throttled", msg: "Too many codes requested", retryAfter: retry}
		}
		store.otpSent[b.Phone] = append(kept, now)
		log.Printf("otp: %s -> code %s", b.Phone, otpCode)
		w.WriteHeader(204)
		return nil
	}))

	mux.HandleFunc("POST /v1/otp/verify", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		var b struct{ Phone, Code string }
		if e := decode(r, &b); e != nil {
			return e
		}
		if len(store.otpSent[b.Phone]) == 0 || b.Code != otpCode {
			return errOf(400, "invalid_otp", "That code didn't match")
		}
		var user *User
		for _, u := range store.users {
			if u.Phone == b.Phone {
				user = u
			}
		}
		if user == nil {
			user = &User{ID: store.nextID("u"), Phone: b.Phone, Onboarding: "profile_incomplete",
				Interests: []string{}, Photos: []*Photo{},
				Prefs: &Prefs{MinAge: 21, MaxAge: 40, MaxDistanceKM: 25, Genders: []string{}, Interests: []string{}}}
			store.users[user.ID] = user
		}
		at, rt := store.issueTokens(user.ID)
		writeJSON(w, 200, map[string]any{"access_token": at, "refresh_token": rt, "user": serializeMe(user)})
		return nil
	}))

	mux.HandleFunc("POST /v1/auth/refresh", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		var b struct {
			RefreshToken string `json:"refresh_token"`
		}
		if e := decode(r, &b); e != nil {
			return e
		}
		uid, ok := store.refresh[b.RefreshToken]
		if !ok || store.users[uid] == nil {
			return errOf(401, "token_expired", "Refresh token invalid")
		}
		delete(store.refresh, b.RefreshToken) // rotating
		at, rt := store.issueTokens(uid)
		writeJSON(w, 200, map[string]any{"access_token": at, "refresh_token": rt})
		return nil
	}))

	mux.HandleFunc("POST /v1/auth/logout", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		var b struct {
			RefreshToken string `json:"refresh_token"`
		}
		_ = decode(r, &b)
		delete(store.refresh, b.RefreshToken)
		w.WriteHeader(204)
		return nil
	}))

	mux.HandleFunc("POST /v1/devices", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		if _, e := authUser(r); e != nil {
			return e
		}
		w.WriteHeader(204)
		return nil
	}))

	mux.HandleFunc("GET /v1/me", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		writeJSON(w, 200, serializeMe(u))
		return nil
	}))

	mux.HandleFunc("PATCH /v1/me/profile", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		var b map[string]any
		if e := decode(r, &b); e != nil {
			return e
		}
		if v, ok := b["birthdate"].(string); ok {
			a := ageOf(v)
			if a < 0 {
				return errOf(400, "validation_failed", "Birthdate must be YYYY-MM-DD")
			}
			if a < 18 {
				return errOf(403, "underage", "You must be 18 or older to use Maktub")
			}
			u.Birthdate = v
		}
		if v, ok := b["name"].(string); ok {
			u.Name = v
		}
		if v, ok := b["gender"].(string); ok {
			u.Gender = v
		}
		if v, ok := b["bio"].(string); ok {
			u.Bio = v
		}
		if v, ok := b["interests"].([]any); ok { // prototype extension
			u.Interests = nil
			for _, x := range v {
				if s, ok := x.(string); ok {
					u.Interests = append(u.Interests, s)
				}
			}
		}
		if v, ok := b["hue_index"].(float64); ok { // prototype extension
			u.HueIndex = int(v)
		}
		if u.Name != "" && u.Birthdate != "" && u.Gender != "" && u.Onboarding != "complete" {
			u.Onboarding = "complete"
			store.seedDemo(u)
		}
		writeJSON(w, 200, serializeMe(u)["profile"])
		return nil
	}))

	mux.HandleFunc("PUT /v1/me/preferences", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		var p Prefs
		if e := decode(r, &p); e != nil {
			return e
		}
		if p.Genders == nil {
			p.Genders = []string{}
		}
		if p.Interests == nil {
			p.Interests = []string{}
		}
		u.Prefs = &p
		writeJSON(w, 200, u.Prefs)
		return nil
	}))

	mux.HandleFunc("PUT /v1/me/location", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		if _, e := authUser(r); e != nil {
			return e
		}
		w.WriteHeader(204) // stored server-side only; never displayed
		return nil
	}))

	mux.HandleFunc("POST /v1/me/photos/presign", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		if _, e := authUser(r); e != nil {
			return e
		}
		key := store.nextID("s3key")
		writeJSON(w, 200, map[string]any{"upload_url": "/v1/uploads/" + key, "key": key})
		return nil
	}))

	mux.HandleFunc("PUT /v1/uploads/{key}", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // contract: <= 10 MB
		store.uploads[r.PathValue("key")] = strings.TrimSpace(string(body))
		w.WriteHeader(200)
		return nil
	}))

	mux.HandleFunc("POST /v1/me/photos/confirm", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		var b struct{ Key string }
		if e := decode(r, &b); e != nil {
			return e
		}
		kind, ok := store.uploads[b.Key]
		if !ok || kind == "" {
			return errOf(404, "not_found", "Nothing uploaded for that key")
		}
		if len(u.Photos) >= 6 {
			return errOf(400, "validation_failed", "Photo limit is 6")
		}
		p := &Photo{ID: store.nextID("ph"), Kind: kind, Status: "pending"}
		u.Photos = append(u.Photos, p)
		scheduleModeration(u.ID, p.ID)
		writeJSON(w, 200, map[string]any{"id": p.ID, "urls": photoURLs(kind), "moderation_status": "pending", "reason": nil})
		return nil
	}))

	mux.HandleFunc("PATCH /v1/me/photos/order", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		var b struct {
			OrderedIDs []string `json:"ordered_ids"`
		}
		if e := decode(r, &b); e != nil {
			return e
		}
		byID := map[string]*Photo{}
		for _, p := range u.Photos {
			byID[p.ID] = p
		}
		var next []*Photo
		for _, id := range b.OrderedIDs {
			if p, ok := byID[id]; ok {
				next = append(next, p)
				delete(byID, id)
			}
		}
		for _, p := range u.Photos {
			if _, left := byID[p.ID]; left {
				next = append(next, p)
			}
		}
		u.Photos = next
		w.WriteHeader(204)
		return nil
	}))

	mux.HandleFunc("DELETE /v1/me/photos/{id}", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		id := r.PathValue("id")
		var next []*Photo
		for _, p := range u.Photos {
			if p.ID != id {
				next = append(next, p)
			}
		}
		u.Photos = next
		w.WriteHeader(204)
		return nil
	}))

	mux.HandleFunc("GET /v1/feed", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		prefs := u.Prefs
		if prefs == nil {
			prefs = &Prefs{MinAge: 18, MaxAge: 99, MaxDistanceKM: 50, Genders: []string{}, Interests: []string{}}
		}
		var bots []*User
		for _, c := range store.users {
			if c.Bot {
				bots = append(bots, c)
			}
		}
		sort.Slice(bots, func(i, j int) bool { return bots[i].Order < bots[j].Order })
		var ids []string
		for _, c := range bots {
			ids = append(ids, c.ID)
		}
		candidates := []map[string]any{}
		for _, id := range ids {
			c := store.users[id]
			if store.swipes[u.ID+"|"+id] != nil || store.blockedEither(u.ID, id) || store.openMatchBetween(u.ID, id) != nil {
				continue
			}
			a := ageOf(c.Birthdate)
			if a < prefs.MinAge || a > prefs.MaxAge || c.DistanceKM > prefs.MaxDistanceKM {
				continue
			}
			if len(prefs.Genders) > 0 && !contains(prefs.Genders, c.Gender) {
				continue
			}
			if len(prefs.Interests) > 0 && !overlaps(prefs.Interests, c.Interests) {
				continue
			}
			candidates = append(candidates, serializeCandidate(c))
		}
		writeJSON(w, 200, map[string]any{"candidates": candidates, "next_cursor": nil})
		return nil
	}))

	mux.HandleFunc("POST /v1/swipes", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		var b struct {
			TargetID  string `json:"target_id"`
			Direction string `json:"direction"`
			ClientID  string `json:"client_id"`
		}
		if e := decode(r, &b); e != nil {
			return e
		}
		target := store.users[b.TargetID]
		if target == nil || !target.Bot {
			return errOf(404, "not_found", "No such user")
		}
		if b.Direction != "like" && b.Direction != "pass" {
			return errOf(400, "validation_failed", "direction must be like|pass")
		}
		key := u.ID + "|" + b.TargetID
		if prior := store.swipes[key]; prior != nil { // idempotent on (user, target)
			var match any
			if prior.MatchID != "" {
				if m := store.matches[prior.MatchID]; m != nil && m.Closed == "" {
					match = store.serializeMatch(m, u.ID)
				}
			}
			writeJSON(w, 200, map[string]any{"match": match})
			return nil
		}
		swipe := &Swipe{Direction: b.Direction, ClientID: b.ClientID}
		store.swipes[key] = swipe
		var match any
		if b.Direction == "like" && target.LikesYou && !store.blockedEither(u.ID, target.ID) {
			m := store.createMatch(u.ID, target.ID, time.Now())
			swipe.MatchID = m.ID
			match = store.serializeMatch(m, u.ID)
		}
		writeJSON(w, 200, map[string]any{"match": match})
		return nil
	}))

	mux.HandleFunc("GET /v1/matches", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		var mine []*Match
		for _, m := range store.matches {
			if m.Closed == "" && (m.Users[0] == u.ID || m.Users[1] == u.ID) {
				mine = append(mine, m)
			}
		}
		sort.Slice(mine, func(i, j int) bool { return lastActivity(mine[i]).After(lastActivity(mine[j])) })
		out := []map[string]any{}
		for _, m := range mine {
			out = append(out, store.serializeMatch(m, u.ID))
		}
		writeJSON(w, 200, map[string]any{"matches": out, "next_cursor": nil})
		return nil
	}))

	mux.HandleFunc("DELETE /v1/matches/{id}", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		m := store.matches[r.PathValue("id")]
		if m == nil || (m.Users[0] != u.ID && m.Users[1] != u.ID) || m.Closed != "" {
			return errOf(404, "not_found", "No such match")
		}
		closeMatch(m, "unmatched")
		w.WriteHeader(204)
		return nil
	}))

	mux.HandleFunc("GET /v1/matches/{id}/messages", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		m := store.matches[r.PathValue("id")]
		if m == nil || (m.Users[0] != u.ID && m.Users[1] != u.ID) {
			return errOf(404, "not_found", "No such match")
		}
		limit := 50
		if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 100 {
			limit = v
		}
		msgs := m.Msgs
		if before := r.URL.Query().Get("before"); before != "" {
			for i, x := range msgs {
				if x.ID == before {
					msgs = msgs[:i]
					break
				}
			}
		}
		start := len(msgs) - limit
		if start < 0 {
			start = 0
		}
		page := msgs[start:]
		out := []map[string]any{}
		for i := len(page) - 1; i >= 0; i-- { // newest-first
			out = append(out, serializeMessage(page[i], m.ID))
		}
		var cursor any
		if start > 0 {
			cursor = page[0].ID
		}
		writeJSON(w, 200, map[string]any{"messages": out, "next_cursor": cursor})
		return nil
	}))

	mux.HandleFunc("POST /v1/matches/{id}/messages", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		var b struct {
			Body     string `json:"body"`
			ClientID string `json:"client_id"`
		}
		if e := decode(r, &b); e != nil {
			return e
		}
		msg, e2 := sendMessage(u, r.PathValue("id"), b.Body, b.ClientID)
		if e2 != nil {
			return e2
		}
		writeJSON(w, 200, serializeMessage(msg, r.PathValue("id")))
		return nil
	}))

	mux.HandleFunc("POST /v1/matches/{id}/read", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		m := store.matches[r.PathValue("id")]
		if m == nil || (m.Users[0] != u.ID && m.Users[1] != u.ID) {
			return errOf(404, "not_found", "No such match")
		}
		var b struct {
			LastMessageID string `json:"last_message_id"`
		}
		if e := decode(r, &b); e != nil {
			return e
		}
		m.Unread[u.ID] = 0
		for _, x := range m.Msgs {
			if x.ID == b.LastMessageID {
				m.LastRead[u.ID] = x.Seq
			}
		}
		w.WriteHeader(204)
		return nil
	}))

	mux.HandleFunc("POST /v1/blocks", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		var b struct {
			UserID string `json:"user_id"`
		}
		if e := decode(r, &b); e != nil {
			return e
		}
		if store.users[b.UserID] == nil {
			return errOf(404, "not_found", "No such user")
		}
		store.blocks[u.ID+"|"+b.UserID] = true
		for _, m := range store.matches {
			if m.Closed == "" && ((m.Users[0] == u.ID && m.Users[1] == b.UserID) || (m.Users[0] == b.UserID && m.Users[1] == u.ID)) {
				closeMatch(m, "blocked")
			}
		}
		w.WriteHeader(204)
		return nil
	}))

	mux.HandleFunc("POST /v1/reports", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		var b struct {
			UserID string `json:"user_id"`
			Reason string `json:"reason"`
			Detail string `json:"detail"`
		}
		if e := decode(r, &b); e != nil {
			return e
		}
		if !reportReasons[b.Reason] {
			return errOf(400, "validation_failed", "Unknown reason")
		}
		if store.users[b.UserID] == nil {
			return errOf(404, "not_found", "No such user")
		}
		store.reports = append(store.reports, Report{ReporterID: u.ID, UserID: b.UserID, Reason: b.Reason, Detail: b.Detail, At: time.Now()})
		w.WriteHeader(204)
		return nil
	}))

	mux.HandleFunc("DELETE /v1/me", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		u, e := authUser(r)
		if e != nil {
			return e
		}
		for _, m := range store.matches {
			if m.Closed == "" && (m.Users[0] == u.ID || m.Users[1] == u.ID) {
				closeMatch(m, "account_deleted")
			}
		}
		delete(store.users, u.ID)
		for t, rec := range store.access {
			if rec.UserID == u.ID {
				delete(store.access, t)
			}
		}
		for t, uid := range store.refresh {
			if uid == u.ID {
				delete(store.refresh, t)
			}
		}
		w.WriteHeader(204)
		return nil
	}))

	mux.HandleFunc("POST /v1/me/export", handler(func(w http.ResponseWriter, r *http.Request) *apiErr {
		if _, e := authUser(r); e != nil {
			return e
		}
		writeJSON(w, 202, map[string]any{"status": "accepted"})
		return nil
	}))

	mux.HandleFunc("GET /v1/ws", serveWS)

	// the web client itself
	mux.Handle("GET /", http.FileServer(http.Dir(*static)))

	log.Printf("maktub server on %s (client from %s); OTP code is always %s", *addr, *static, otpCode)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatal(err)
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func overlaps(a, b []string) bool {
	for _, x := range a {
		if contains(b, x) {
			return true
		}
	}
	return false
}

func lastActivity(m *Match) time.Time {
	if len(m.Msgs) > 0 {
		return m.Msgs[len(m.Msgs)-1].CreatedAt
	}
	return m.CreatedAt
}

var _ = fmt.Sprintf
