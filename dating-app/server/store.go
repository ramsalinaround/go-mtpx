package main

// In-memory reference implementation of docs/spec/02-api-contract.md.
// Mirrors the client's in-page mock backend so both transports behave
// identically; a production build would swap this store for Postgres/Redis/S3.

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

const (
	otpCode      = "123456" // prototype: no SMS provider
	accessTTL    = 15 * time.Minute
	moderationMS = 2500
)

type Photo struct {
	ID     string
	Kind   string
	Status string // pending | approved | rejected
	Reason string
}

type Prefs struct {
	MinAge        int      `json:"min_age"`
	MaxAge        int      `json:"max_age"`
	MaxDistanceKM int      `json:"max_distance_km"`
	Genders       []string `json:"genders"`
	Interests     []string `json:"interests"` // prototype extension
}

type User struct {
	Order      int // feed ordering parity with the client's mock backend
	ID         string
	Phone      string
	Bot        bool
	Name       string
	Birthdate  string // YYYY-MM-DD; age is derived, DOB never serialized to others
	Gender     string
	Bio        string
	Job        string
	Interests  []string
	HueIndex   int
	DistanceKM int
	LikesYou   bool
	Replies    []string
	Photos     []*Photo
	Prefs      *Prefs
	Onboarding string // profile_incomplete | complete
	SeededDemo bool
}

type Message struct {
	ID        string
	Seq       int
	SenderID  string
	Body      string
	CreatedAt time.Time
	ClientID  string
}

type Match struct {
	ID        string
	Users     [2]string
	CreatedAt time.Time
	Msgs      []*Message
	Unread    map[string]int
	LastRead  map[string]int
	Closed    string // "" | unmatched | blocked | account_deleted
}

type Swipe struct {
	Direction string
	ClientID  string
	MatchID   string
}

type Report struct {
	ReporterID string
	UserID     string
	Reason     string
	Detail     string
	At         time.Time
}

type tokenRec struct {
	UserID    string
	ExpiresAt time.Time
}

type Store struct {
	mu      sync.Mutex
	seq     int
	users   map[string]*User
	swipes  map[string]*Swipe // "uid|tid"
	matches map[string]*Match
	blocks  map[string]bool // "uid|tid"
	reports []Report
	otpSent map[string][]time.Time
	access  map[string]tokenRec
	refresh map[string]string // token -> uid
	uploads map[string]string // key -> kind
}

var reportReasons = map[string]bool{
	"spam_or_fake": true, "inappropriate_messages": true, "inappropriate_photos": true,
	"underage": true, "safety_concern": true, "other": true,
}

type botDef struct {
	id, name, gender, job, bio string
	age, dist, hue             int
	likesYou, seeded           bool
	interests, replies         []string
	photos                     []Photo
}

var botDefs = []botDef{
	{"maya", "Maya", "woman", "Photographer", "Chasing golden hour and the city's best bánh mì.", 28, 4, 4, true, true,
		[]string{"Photography", "Travel", "Coffee"},
		[]string{"Okay that's a strong opinion and I respect it.", "Ha! I was literally about to say the same thing.", "You free this weekend? There's a print fair on Saturday."}, nil},
	{"jonah", "Jonah", "man", "Barista & writer", "Short stories, long pours.", 29, 6, 5, true, true,
		[]string{"Coffee", "Books", "Film"},
		[]string{"That's going straight into a story, fair warning.", "Strong agree. Also: have you read anything good lately?", "I make a mean cortado if you ever want a taste test."}, nil},
	{"priya", "Priya", "woman", "Ceramicist", "I make bowls on purpose and friends by accident.", 27, 3, 0, true, false,
		[]string{"Art", "Coffee", "Yoga"},
		[]string{"Careful, I already like you.", "Okay, tell me more.", "You can come throw a pot sometime. It's messier than it looks."},
		[]Photo{{Kind: "sunset", Status: "approved"}}},
	{"theo", "Theo", "man", "Chef", "I'll cook, you pick the record.", 29, 5, 2, false, false,
		[]string{"Cooking", "Wine", "Live music"},
		[]string{"Ha, deal.", "What's the last great thing you ate?"},
		[]Photo{{Kind: "cafe", Status: "pending"}}},
	{"amara", "Amara", "woman", "Med resident", "Runs on 6am jogs and library naps.", 25, 8, 3, true, false,
		[]string{"Running", "Books", "Dogs"},
		[]string{"Ha! My schedule is chaos but I like your energy.", "A dog park date is objectively the best first date. Discuss.", "Okay you're funny. Keep going."},
		[]Photo{{Kind: "coast", Status: "approved"}}},
	{"luca", "Luca", "man", "Architect", "I point at buildings a lot. Warning you now.", 31, 2, 4, false, false,
		[]string{"Photography", "Film", "Travel"},
		[]string{"Fair point, well made.", "Which building though?"}, nil},
	{"noor", "Noor", "woman", "Climate researcher", "Half in the mountains, half in spreadsheets.", 26, 12, 3, true, false,
		[]string{"Hiking", "Climbing", "Board games"},
		[]string{"Counterpoint: sunrise hikes are worth it exactly once a month.", "I have a 7-game backlog of Cascadia. Consider this a warning.", "You'd survive a long hike with me. I can tell."},
		[]Photo{{Kind: "mountain", Status: "approved"}}},
	{"felix", "Felix", "man", "Bassist", "In a band you've almost heard of.", 28, 6, 1, false, false,
		[]string{"Live music", "Film", "Coffee"},
		[]string{"Ha! Almost is the operative word.", "Come to a show sometime."}, nil},
	{"ivy", "Ivy", "woman", "Illustrator", "Draws strangers on the train (flatteringly).", 24, 9, 0, false, false,
		[]string{"Art", "Books", "Dogs"},
		[]string{"You'd make a good sketch, for the record.", "Ha, noted!"}, nil},
	{"mateo", "Mateo", "man", "Teacher", "Grade-A pun dispenser. Detention for ghosting.", 30, 4, 5, true, false,
		[]string{"Board games", "Cooking", "Running"},
		[]string{"Solid answer. Gold star.", "Okay but real question: pineapple on pizza?", "You'd like my trivia team. We lose with dignity."}, nil},
	{"sasha", "Sasha", "woman", "Pilot", "Layovers are just speed-run city tours.", 27, 15, 4, false, false,
		[]string{"Travel", "Surfing", "Wine"},
		[]string{"Window seat or aisle? This matters.", "Ha! Safe answer."}, nil},
	{"wren", "Wren", "woman", "Florist", "Knows the meaning of every flower. Uses it for gossip.", 26, 7, 3, true, false,
		[]string{"Art", "Hiking", "Coffee"},
		[]string{"You get yellow acacia. Look it up.", "Okay that made me actually laugh.", "Bring me a weird flower fact and I'm yours."},
		[]Photo{{Kind: "forest", Status: "approved"}}},
	{"daniel", "Daniel", "man", "Carpenter", "I make sturdy things. Emotionally, also sturdy.", 33, 10, 2, false, false,
		[]string{"Climbing", "Dogs", "Photography"},
		[]string{"Measured twice before sending this.", "Ha. Good one."}, nil},
	{"zoe", "Zoe", "woman", "Grad student", "Thesis: vibes. Methodology: playlists.", 25, 5, 1, true, false,
		[]string{"Yoga", "Books", "Live music"},
		[]string{"Peer review says: you're interesting.", "Adding that take to my lit review.", "Send me one song that never fails. Choose wisely."},
		[]Photo{{Kind: "studio", Status: "approved"}}},
}

func NewStore() *Store {
	s := &Store{
		users:   map[string]*User{},
		swipes:  map[string]*Swipe{},
		matches: map[string]*Match{},
		blocks:  map[string]bool{},
		otpSent: map[string][]time.Time{},
		access:  map[string]tokenRec{},
		refresh: map[string]string{},
		uploads: map[string]string{},
	}
	year := time.Now().Year()
	for i, b := range botDefs {
		u := &User{
			Order: i,
			ID:    b.id, Bot: true, Name: b.name, Gender: b.gender, Job: b.job, Bio: b.bio,
			Birthdate: fmt.Sprintf("%d-06-15", year-b.age), Interests: b.interests,
			HueIndex: b.hue, DistanceKM: b.dist, LikesYou: b.likesYou, SeededDemo: b.seeded,
			Replies: b.replies, Onboarding: "complete",
		}
		for j, p := range b.photos {
			u.Photos = append(u.Photos, &Photo{ID: fmt.Sprintf("bph_%s_%d", b.id, j), Kind: p.Kind, Status: p.Status})
		}
		s.users[u.ID] = u
	}
	return s
}

func (s *Store) nextID(prefix string) string {
	s.seq++
	return fmt.Sprintf("%s_%d_%04d", prefix, s.seq, rand.Intn(10000))
}

func ageOf(birthdate string) int {
	b, err := time.Parse("2006-01-02", birthdate)
	if err != nil {
		return -1
	}
	n := time.Now().UTC()
	a := n.Year() - b.Year()
	if n.YearDay() < b.YearDay() {
		a--
	}
	return a
}

func isoTime(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func photoURLs(kind string) map[string]string {
	// opaque tokens the client resolves against its scene map; never constructed client-side
	return map[string]string{"thumb": kind, "card": kind, "full": kind}
}

/* ---------- serializers (JSON shapes identical to the in-page mock) ---------- */

func serializeCandidate(u *User) map[string]any {
	photos := []map[string]any{}
	for _, p := range u.Photos {
		if p.Status == "approved" { // spec P0 #7: only approved photos serialize to others
			photos = append(photos, map[string]any{"id": p.ID, "urls": photoURLs(p.Kind)})
		}
	}
	return map[string]any{
		"id": u.ID, "name": u.Name, "age": ageOf(u.Birthdate), "gender": u.Gender,
		"distance_km": u.DistanceKM, "job": u.Job, "bio": u.Bio,
		"interests": u.Interests, "hue_index": u.HueIndex, "photos": photos,
	}
}

func serializeMe(u *User) map[string]any {
	photos := []map[string]any{}
	for _, p := range u.Photos {
		var reason any
		if p.Reason != "" {
			reason = p.Reason
		}
		photos = append(photos, map[string]any{
			"id": p.ID, "urls": photoURLs(p.Kind), "moderation_status": p.Status, "reason": reason,
		})
	}
	var phone any
	if u.Phone != "" {
		phone = u.Phone
	}
	return map[string]any{
		"id": u.ID, "phone": phone, "onboarding_state": u.Onboarding,
		"profile": map[string]any{
			"name": u.Name, "birthdate": u.Birthdate, "gender": u.Gender, "bio": u.Bio,
			"interests": u.Interests, "hue_index": u.HueIndex,
		},
		"preferences": u.Prefs, "photos": photos,
	}
}

func serializeMessage(m *Message, matchID string) map[string]any {
	var cid any
	if m.ClientID != "" {
		cid = m.ClientID
	}
	return map[string]any{
		"id": m.ID, "seq": m.Seq, "match_id": matchID, "sender_id": m.SenderID,
		"body": m.Body, "created_at": isoTime(m.CreatedAt), "client_id": cid,
	}
}

func (m *Match) partnerOf(uid string) string {
	if m.Users[0] == uid {
		return m.Users[1]
	}
	return m.Users[0]
}

func (s *Store) serializeMatch(m *Match, uid string) map[string]any {
	partner := s.users[m.partnerOf(uid)]
	var last any
	if len(m.Msgs) > 0 {
		last = serializeMessage(m.Msgs[len(m.Msgs)-1], m.ID)
	}
	return map[string]any{
		"id": m.ID, "created_at": isoTime(m.CreatedAt), "user": serializeCandidate(partner),
		"last_message": last, "unread_count": m.Unread[uid],
		"their_last_read_seq": m.LastRead[partner.ID],
	}
}

/* ---------- core ops (called with s.mu held) ---------- */

func (s *Store) blockedEither(a, b string) bool {
	return s.blocks[a+"|"+b] || s.blocks[b+"|"+a]
}

func (s *Store) openMatchBetween(a, b string) *Match {
	for _, m := range s.matches {
		if m.Closed == "" && ((m.Users[0] == a && m.Users[1] == b) || (m.Users[0] == b && m.Users[1] == a)) {
			return m
		}
	}
	return nil
}

func (s *Store) createMatch(a, b string, at time.Time) *Match {
	m := &Match{ID: s.nextID("m"), Users: [2]string{a, b}, CreatedAt: at,
		Unread: map[string]int{}, LastRead: map[string]int{}}
	s.matches[m.ID] = m
	return m
}

func (s *Store) pushMessage(m *Match, senderID, body, clientID string) *Message {
	s.seq++
	msg := &Message{ID: s.nextID("msg"), Seq: s.seq, SenderID: senderID, Body: body,
		CreatedAt: time.Now(), ClientID: clientID}
	m.Msgs = append(m.Msgs, msg)
	m.Unread[m.partnerOf(senderID)]++
	return msg
}

func (s *Store) seedDemo(u *User) {
	if u.SeededDemo {
		return
	}
	u.SeededDemo = true
	dayAgo := time.Now().Add(-24 * time.Hour)
	maya := s.createMatch(u.ID, "maya", dayAgo)
	s.pushMessage(maya, "maya", "Okay, your bio made me laugh. Hi!", "")
	s.pushMessage(maya, u.ID, "Ha, mission accomplished. Hi Maya!", "")
	s.pushMessage(maya, "maya", "So — film or digital? Answer carefully.", "")
	maya.Unread[u.ID] = 0
	maya.Unread["maya"] = 0
	maya.LastRead[u.ID] = maya.Msgs[len(maya.Msgs)-1].Seq
	maya.LastRead["maya"] = maya.Msgs[len(maya.Msgs)-1].Seq
	jonah := s.createMatch(u.ID, "jonah", dayAgo)
	s.pushMessage(jonah, "jonah", "I've decided your coffee order says everything about you. What is it?", "")
	s.swipes[u.ID+"|maya"] = &Swipe{Direction: "like", MatchID: maya.ID}
	s.swipes[u.ID+"|jonah"] = &Swipe{Direction: "like", MatchID: jonah.ID}
}

func (s *Store) issueTokens(uid string) (string, string) {
	at := s.nextID("at")
	rt := s.nextID("rt")
	s.access[at] = tokenRec{UserID: uid, ExpiresAt: time.Now().Add(accessTTL)}
	s.refresh[rt] = uid
	return at, rt
}
