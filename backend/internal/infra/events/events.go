// Package events — the event bus: a transactional outbox, a relay, and declared subscribers.
//
// An event is a string type plus JSON, never a Go type per event. It is born two ways and lands
// in the same `events` table:
//   - row changes, written by a database trigger (corpus_notes → corpus.note.changed), so no write
//     path can forget to emit;
//   - domain facts, written by a use case with Recorder.With(tx).Record(…) inside its own
//     transaction, so the fact and the change commit together.
//
// The relay (relay.go) claims unfanned rows with SKIP LOCKED and enqueues one durable job per
// matching subscriber, in the same transaction that stamps the rows. Handling is therefore
// at-least-once: subscribers must be idempotent.
//
// This package knows only type strings and JSON; no domain is imported (check-infra-not-domain).
package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Channel — the NOTIFY channel the trigger and Record use to wake the relay.
const Channel = "standmeet_events"

// FannedChannel — NOTIFY after a fan-out commits; the payload is the event ids.
const FannedChannel = "standmeet_events_fanned"

// maxFanoutWaiters — requests waiting for a fan-out at once.
const maxFanoutWaiters = 64

// Event — one outbox row.
type Event struct {
	OccurredAt  time.Time       `json:"occurred_at"`
	FannedOutAt *time.Time      `json:"fanned_out_at,omitempty"`
	ID          string          `json:"id"`
	OwnerID     string          `json:"owner_id,omitempty"`
	Type        string          `json:"type"`
	Subject     string          `json:"subject"`
	LastError   string          `json:"last_error,omitempty"`
	Data        json.RawMessage `json:"data"`
	Fanout      []Target        `json:"fanout"`
	Seq         int64           `json:"seq"`
	Poisoned    bool            `json:"poisoned,omitempty"`
}

// Target — the job one subscriber got for an event.
type Target struct {
	Subscriber string     `json:"subscriber"`
	JobID      jobs.JobID `json:"job_id"`
}

// Subscription — a named handler for a set of type globs. Its name is also its job kind.
type Subscription struct {
	Handle      func(ctx context.Context, ev Event) error
	Backoff     func(attempt int) time.Duration
	Name        string // "corpus.index"
	Queue       string
	Types       []string // globs: "corpus.note.*"
	MaxAttempts int
	Timeout     time.Duration
	// Coalesce —— within one relay batch, only the latest event of a subject gets a job. Right
	// for a subscriber that re-reads current state (the search index); wrong for one that
	// delivers facts (webhooks, mail): two events about one subject are two things that happened.
	Coalesce bool
}

// JobArgs — what a subscriber's job carries: the event id and, for the panel, its subject.
type JobArgs struct {
	EventID string `json:"event_id"`
	Subject string `json:"subject"`
}

// ErrUndeclaredType — Record of a type nobody declared.
var ErrUndeclaredType = errors.New("undeclared event type")

// ErrNotFound — no event with that id.
var ErrNotFound = errors.New("event not found")

// Bus — declarations, the recorder, the relay and the reads.
type Bus struct {
	pool      *pgxpool.Pool
	types     map[string]Type
	stop      context.CancelFunc
	done      chan struct{}
	log       *slog.Logger
	relayWake *pgstore.Listener // NOTIFY on Channel: new events to fan out
	fanned    *pgstore.Listener // NOTIFY on FannedChannel: these events have their jobs
	subs      []Subscription
}

// New — validates the declarations. Every trigger-written type must be declared too.
func New(pool *pgxpool.Pool, types []Type, subs []Subscription) (*Bus, error) {
	declared, err := declareTypes(types)
	if err != nil {
		return nil, err
	}
	b := &Bus{
		pool: pool, types: declared, log: slog.New(slog.DiscardHandler),
		relayWake: pgstore.NewListener(pool, Channel, 1, nil),
		fanned:    pgstore.NewListener(pool, FannedChannel, maxFanoutWaiters, nil),
	}
	seen := map[string]bool{}
	for i := range subs {
		if verr := b.validate(&subs[i], seen); verr != nil {
			return nil, verr
		}
	}
	b.subs = subs
	return b, nil
}

// SetLogger — where relay warnings go.
func (b *Bus) SetLogger(log *slog.Logger) { b.log = log }

// Kinds — one job kind per subscription; hand these to the jobs runtime.
func (b *Bus) Kinds() []jobs.Kind {
	out := make([]jobs.Kind, 0, len(b.subs))
	for i := range b.subs {
		out = append(out, b.kindOf(&b.subs[i]))
	}
	return out
}

func (b *Bus) validate(s *Subscription, seen map[string]bool) error {
	switch {
	case s.Name == "" || s.Handle == nil:
		return fmt.Errorf("subscription %q: needs a name and a handler", s.Name)
	case seen[s.Name]:
		return fmt.Errorf("subscription %q declared twice", s.Name)
	}
	seen[s.Name] = true
	if err := b.checkGlobs(s); err != nil {
		return err
	}
	k := b.kindOf(s)
	return k.Validate()
}

// checkGlobs — every glob of s must match at least one declared type.
func (b *Bus) checkGlobs(s *Subscription) error {
	for _, g := range s.Types {
		if !b.matchesAny(g) {
			return fmt.Errorf("subscription %q: %q matches no declared event type", s.Name, g)
		}
	}
	return nil
}

func (b *Bus) kindOf(s *Subscription) jobs.Kind {
	handle := s.Handle
	return jobs.Kind{
		Name: s.Name, Queue: s.Queue, MaxAttempts: s.MaxAttempts, Timeout: s.Timeout,
		Backoff: s.Backoff,
		Handle: func(ctx context.Context, raw json.RawMessage) error {
			var a JobArgs
			if err := json.Unmarshal(raw, &a); err != nil {
				return jobs.Discard(fmt.Errorf("bad event job args: %w", err))
			}
			ev, err := b.Get(ctx, a.EventID)
			if errors.Is(err, ErrNotFound) {
				return jobs.Discard(err) // pruned; nothing left to deliver
			}
			if err != nil {
				return err
			}
			return handle(ctx, ev)
		},
	}
}
