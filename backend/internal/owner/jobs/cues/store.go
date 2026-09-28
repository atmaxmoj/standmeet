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

// Kinds a push may carry: heard = a transcript line, cue = a card (streamed, latest wins).
const (
	KindHeard = "heard"
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
		return fmt.Errorf("%w: kind must be heard or cue", errBadEvent)
	case e.ID == "" || len(e.ID) > maxID:
		return fmt.Errorf("%w: id is required (max %d chars)", errBadEvent, maxID)
	case len(e.Text) > maxText:
		return fmt.Errorf("%w: text over %d chars", errBadEvent, maxText)
	}
	return nil
}

var validKinds = map[string]bool{KindHeard: true, KindCue: true}

// IsBadEvent —— a validation failure the caller should show as-is.
func IsBadEvent(err error) bool { return errors.Is(err, errBadEvent) }

// Store —— Redis-backed feed.
type Store struct{ rdb *redis.Client }

// New —— constructs Store.
func New(rdb *redis.Client) *Store { return &Store{rdb: rdb} }

func listKey(ownerID string) string { return "cues:" + ownerID }
func seqKey(ownerID string) string  { return "cues:" + ownerID + ":seq" }

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
		return nil
	})
	if err != nil {
		return fmt.Errorf("cues push: %w", err)
	}
	return nil
}

// Since —— the events after seq, oldest first. A reader passes the last seq it saw.
func (s *Store) Since(ctx context.Context, ownerID string, seq int64) ([]Event, error) {
	rows, err := s.rdb.LRange(ctx, listKey(ownerID), 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("cues read: %w", err)
	}
	out := make([]Event, 0, len(rows))
	for _, r := range rows {
		var e Event
		if json.Unmarshal([]byte(r), &e) != nil || e.Seq <= seq {
			continue
		}
		out = append(out, e)
	}
	return out, nil
}
