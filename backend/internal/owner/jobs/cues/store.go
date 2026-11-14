// Package cues —— the screen assistant's live feed. The desktop cue app (a Cheating Daddy fork
// on the owner's computer) pushes what it heard and the cue cards it wrote; /admin/screen-assistant
// reads them back, so the owner can follow the cards on a phone while the desktop window is
// minimized.
//
// The feed is ephemeral: a Redis list per owner, capped and expiring. A cue streams as growing
// text under one id, so each push is an event and the reader keeps the latest text per id.
package cues

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// keepEvents —— a streamed cue is ~20 pushes; this holds the last dozen cards or so.
	keepEvents = 400
	ttl        = 12 * time.Hour
	maxText    = 8000
	maxID      = 64
)

// Kinds a push may carry: heard = the other side's line (the desktop app cues it), said = the
// owner's own line (transcript only), cue = a card (streamed, latest wins).
const (
	KindHeard = "heard"
	KindSaid  = "said"
	KindCue   = "cue"
)

var errBadEvent = errors.New("bad event")

// Event —— one push. Seq and At are stamped by the store.
type Event struct {
	At   time.Time `json:"at"`
	ID   string    `json:"id"`
	Kind string    `json:"kind"`
	Text string    `json:"text"`
	Seq  int64     `json:"seq"`
}

// Validate —— the MCP input is untrusted; reject what the feed can't show.
func (e *Event) Validate() error {
	switch {
	case !validKinds[e.Kind]:
		return fmt.Errorf("%w: kind must be heard, said or cue", errBadEvent)
	case e.ID == "" || len(e.ID) > maxID:
		return fmt.Errorf("%w: id is required (max %d chars)", errBadEvent, maxID)
	case len(e.Text) > maxText:
		return fmt.Errorf("%w: text over %d chars", errBadEvent, maxText)
	}
	return nil
}

var validKinds = map[string]bool{KindHeard: true, KindSaid: true, KindCue: true}

// IsBadEvent —— a validation failure the caller should show as-is.
func IsBadEvent(err error) bool { return errors.Is(err, errBadEvent) }

// Store —— Redis-backed feed.
type Store struct{ rdb *redis.Client }

// New —— constructs Store.
func New(rdb *redis.Client) *Store { return &Store{rdb: rdb} }

func listKey(ownerID string) string   { return "cues:" + ownerID }
func seqKey(ownerID string) string    { return "cues:" + ownerID + ":seq" }
func viewerKey(ownerID string) string { return "cues:" + ownerID + ":viewer" }
func activeKey(ownerID string) string { return "cues:" + ownerID + ":active" }

// sessionTTL —— how long a cue session stays "live" after the last push. The screen assistant is a
// per-owner singleton: assistant.prepare starts it, pushes keep it alive, and when the interview
// stops pushing the session lapses within this window and /cue goes empty again. Long enough to
// ride out a pause in the conversation (a long answer with no new heard/said line).
const sessionTTL = 3 * time.Minute

// viewerTTL —— how long a /cue heartbeat keeps the phone "present". The phone beats every ~2s; two
// missed beats (phone locked, /cue backgrounded, out of signal) and presence lapses, so the desktop
// takes the display back. Short enough that putting the phone down hands it back promptly.
const viewerTTL = 5 * time.Second

// MarkViewing —— the phone's /cue view is on screen now: hold presence for viewerTTL. Called on
// each /cue heartbeat (owner-scoped). While it holds, the desktop cue app defers to the phone.
func (s *Store) MarkViewing(ctx context.Context, ownerID string) error {
	if err := s.rdb.Set(ctx, viewerKey(ownerID), "1", viewerTTL).Err(); err != nil {
		return fmt.Errorf("cues mark viewing: %w", err)
	}
	return nil
}

// ViewerPresent —— whether a phone is viewing /cue right now (a heartbeat landed within viewerTTL).
// The desktop reads this on assistant.read and hides its cards while it is true.
func (s *Store) ViewerPresent(ctx context.Context, ownerID string) (bool, error) {
	n, err := s.rdb.Exists(ctx, viewerKey(ownerID)).Result()
	if err != nil {
		return false, fmt.Errorf("cues viewer present: %w", err)
	}
	return n > 0, nil
}

// StartSession —— begin the owner's single live cue session: clear the previous session's feed and
// mark the session active. assistant.prepare calls it; reads return nothing until it runs, so /cue
// is empty whenever no interview is underway and a stray push (no session) never shows.
func (s *Store) StartSession(ctx context.Context, ownerID string) error {
	if err := s.rdb.Del(ctx, listKey(ownerID), seqKey(ownerID)).Err(); err != nil {
		return fmt.Errorf("cues clear: %w", err)
	}
	if err := s.rdb.Set(ctx, activeKey(ownerID), "1", sessionTTL).Err(); err != nil {
		return fmt.Errorf("cues start session: %w", err)
	}
	return nil
}

// Push —— stamp Seq/At on e and append it to the owner's feed.
func (s *Store) Push(ctx context.Context, ownerID string, e *Event) error {
	if err := e.Validate(); err != nil {
		return err
	}
	seq, err := s.rdb.Incr(ctx, seqKey(ownerID)).Result()
	if err != nil {
		return fmt.Errorf("cues seq: %w", err)
	}
	e.Seq, e.At = seq, time.Now().UTC()
	raw, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("cues marshal: %w", err)
	}
	_, err = s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.RPush(ctx, listKey(ownerID), raw)
		p.LTrim(ctx, listKey(ownerID), -keepEvents, -1)
		p.Expire(ctx, listKey(ownerID), ttl)
		p.Expire(ctx, seqKey(ownerID), ttl)
		// Keep the session alive while cards flow — but never create it: Expire no-ops on a missing
		// key, so a push with no prepared session (a stray test push) stays invisible.
		p.Expire(ctx, activeKey(ownerID), sessionTTL)
		return nil
	})
	if err != nil {
		return fmt.Errorf("cues push: %w", err)
	}
	return nil
}

// Latest —— one event per id, holding its latest text and seq, in the order the ids first
// appear: a streamed cue reads as one card, as on the page.
func Latest(events []Event) []Event {
	at := map[string]int{}
	out := make([]Event, 0, len(events))
	for _, e := range events {
		if i, ok := at[e.ID]; ok {
			out[i] = e
			continue
		}
		at[e.ID] = len(out)
		out = append(out, e)
	}
	return out
}

// Since —— the events after seq, oldest first, but only while a session is live (the screen
// assistant is a per-owner singleton: no active session → nothing to show, so /cue stays empty
// between interviews). A reader passes the last seq it saw.
//
// Reset recovery: the feed's keys expire after ttl, so the seq counter restarts
// at 1 on the next push. A reader left open (a /cue page) only ever raises its
// cursor, so after a reset its seq sits above the restarted feed and it would
// poll empty forever. When the highest seq held is below the caller's cursor, the
// feed has reset — serve everything, and the cursor falls back into range next poll.
func (s *Store) Since(ctx context.Context, ownerID string, seq int64) ([]Event, error) {
	active, err := s.SessionActive(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	if !active {
		return []Event{}, nil
	}
	events, err := s.readAll(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	return after(events, seq), nil
}

// SessionActive —— is an interview underway (prepare ran and pushes are still arriving within
// sessionTTL)? Reads gate on this so /cue shows cards only while a session is live; the SSE stream
// also reads it, to clear the phone when a live session lapses.
func (s *Store) SessionActive(ctx context.Context, ownerID string) (bool, error) {
	n, err := s.rdb.Exists(ctx, activeKey(ownerID)).Result()
	if err != nil {
		return false, fmt.Errorf("cues session active: %w", err)
	}
	return n > 0, nil
}

// after —— the events past seq. A cursor above the feed's highest seq means the feed reset below it
// (a new session restarted seq at 1 under a page still holding the old cursor) — serve everything,
// and the cursor falls back into range on the next poll.
func after(events []Event, seq int64) []Event {
	if seq > maxSeq(events) {
		seq = 0
	}
	out := make([]Event, 0, len(events))
	for _, e := range events {
		if e.Seq > seq {
			out = append(out, e)
		}
	}
	return out
}

// readAll —— every event in the feed, oldest first.
func (s *Store) readAll(ctx context.Context, ownerID string) ([]Event, error) {
	rows, err := s.rdb.LRange(ctx, listKey(ownerID), 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("cues read: %w", err)
	}
	out := make([]Event, 0, len(rows))
	for _, r := range rows {
		var e Event
		if json.Unmarshal([]byte(r), &e) == nil {
			out = append(out, e)
		}
	}
	return out, nil
}

// maxSeq —— the highest seq among events, or 0 if none.
func maxSeq(events []Event) int64 {
	var m int64
	for _, e := range events {
		if e.Seq > m {
			m = e.Seq
		}
	}
	return m
}
