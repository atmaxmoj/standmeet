// Package jobs — durable background work behind our own interfaces.
//
// Everything that runs after a request returns — an index update, a mail, a webhook, a periodic
// sweep — is a job: bounded (per-queue worker limits), time-limited (per-kind timeout), durable
// (a row in Postgres, so a restart resumes it) and visible (the admin Tasks panel reads the rows).
//
// The upper layers see only this package: strings and JSON. The implementation lives in
// internal/infra/jobs/river (River on Postgres), the only package allowed to import riverqueue
// (gate: check-queue-behind-port.sh). Replacing it must not change any code outside that
// directory; conformance_test.go states the contract every implementation must pass unchanged.
//
// Retry has one owner — this layer. A handler only classifies its failure:
//   - return nil            → completed
//   - return Snooze(d)      → try again after d, without consuming an attempt (429 / Retry-After)
//   - return Discard(err)   → permanent failure, no more attempts (410, SSRF-blocked, …)
//   - return any other err  → retryable, on the kind's backoff until MaxAttempts
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Queues. Separate queues have separate worker limits, so a slow webhook receiver can only fill
// the webhook queue; it cannot slow indexing or mail.
const (
	QueueIndex       = "index"
	QueueNotify      = "notify"
	QueueWebhook     = "webhook"
	QueueMaintenance = "maintenance"
	QueueFetch       = "fetch" // outbound pulls from third-party boards (slow, many at once)
)

// QueueWorkers — MaxWorkers per queue. Starting values; tuned by measurement.
var QueueWorkers = map[string]int{ //nolint:gochecknoglobals // the declared queue table
	QueueIndex:       4,
	QueueNotify:      2,
	QueueWebhook:     8,
	QueueMaintenance: 1,
	QueueFetch:       3,
}

// QueueAwaited — the queues a request waits on: a write's index receipt and a mail receipt wait
// up to 2 s for their job. A job there must not sit until the next poll when its insert
// notification is swallowed, so these queues poll often (see the runtime adapter).
var QueueAwaited = map[string]bool{ //nolint:gochecknoglobals // the declared queue table
	QueueIndex:  true,
	QueueNotify: true,
}

// JobID — the receipt for enqueued work.
type JobID int64

// Handler — does one job. args is exactly what was enqueued.
type Handler func(ctx context.Context, args json.RawMessage) error

// Kind — the declaration of one kind of job (data).
type Kind struct {
	Handle      Handler
	Backoff     func(attempt int) time.Duration // nil → DefaultBackoff
	Name        string                          // "corpus.index"
	Queue       string                          // one of the Queue* constants
	MaxAttempts int                             // at least 1
	Timeout     time.Duration                   // hard limit per attempt; positive
}

// Periodic — the declaration of one periodic job. Run on the elected leader only, once at start
// and then every Every. A failed run is not retried: the next period is the retry.
type Periodic struct {
	Run   func(ctx context.Context) error
	Name  string
	Every time.Duration
}

// PeriodicKind — the job kind a periodic declaration runs as.
func PeriodicKind(name string) string { return "periodic:" + name }

// EnqueueOpts — optional scheduling.
type EnqueueOpts struct {
	RunAt time.Time // zero → as soon as a worker is free
	// UniqueByArgs —— while a job of this kind with exactly these args is waiting, running or
	// completed, enqueueing it again adds nothing and returns that job's id. For work that must
	// happen once per args even when the caller runs twice (at-least-once delivery).
	UniqueByArgs bool
}

// ErrNotFound — no job with that id.
var ErrNotFound = errors.New("job not found")

// ErrUnknownKind — Enqueue of a kind nobody declared. Surfaces at the call, not as a job that
// can never run.
var ErrUnknownKind = errors.New("unknown job kind")

type snoozeError struct{ d time.Duration }

func (e *snoozeError) Error() string { return fmt.Sprintf("snoozed for %s", e.d) }

// Snooze — try again after d without consuming an attempt.
func Snooze(d time.Duration) error { return &snoozeError{d: d} }

// SnoozeOf — the snooze duration, if err is a Snooze.
func SnoozeOf(err error) (time.Duration, bool) {
	var s *snoozeError
	if errors.As(err, &s) {
		return s.d, true
	}
	return 0, false
}

type discardError struct{ err error }

func (e *discardError) Error() string { return "permanent: " + e.err.Error() }
func (e *discardError) Unwrap() error { return e.err }

// Discard — a permanent failure: no further attempts.
func Discard(err error) error {
	if err == nil {
		err = errors.New("discarded")
	}
	return &discardError{err: err}
}

// IsDiscard — whether err is a Discard.
func IsDiscard(err error) bool {
	var d *discardError
	return errors.As(err, &d)
}

const (
	backoffBase = time.Second
	backoffCap  = 15 * time.Minute
)

// DefaultBackoff — from 1 s, doubling, capped at 15 min. Jitter is added by the implementation.
func DefaultBackoff(attempt int) time.Duration {
	d := backoffBase
	for i := 1; i < attempt && d < backoffCap; i++ {
		d *= 2
	}
	return min(d, backoffCap)
}

// Validate — a declaration error is a boot error, not a job that silently never runs.
func (k *Kind) Validate() error {
	switch {
	case k.Name == "":
		return errors.New("job kind: empty name")
	case k.Handle == nil:
		return fmt.Errorf("job kind %q: no handler", k.Name)
	case QueueWorkers[k.Queue] == 0:
		return fmt.Errorf("job kind %q: unknown queue %q", k.Name, k.Queue)
	}
	return k.validateLimits()
}

// validateLimits — the attempt and timeout limits of a named kind.
func (k *Kind) validateLimits() error {
	switch {
	case k.MaxAttempts < 1:
		return fmt.Errorf("job kind %q: MaxAttempts must be ≥ 1", k.Name)
	case k.Timeout <= 0:
		return fmt.Errorf("job kind %q: Timeout must be > 0", k.Name)
	}
	return nil
}
