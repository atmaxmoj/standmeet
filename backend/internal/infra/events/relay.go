// relay.go — from the outbox to jobs.
//
// A pass claims at most RelayBatch unfanned rows with FOR UPDATE SKIP LOCKED, enqueues one job per
// subscriber and event — or, for a Coalesce subscriber, per subject, where the latest event of a
// subject wins inside a batch — and stamps the rows,
// all in one transaction. So a crash mid-pass rolls everything back and the rows are claimed
// again; two relays never take the same row; and a row that commits late is still unfanned when
// the relay next looks, because nothing moves past it.
//
// A failing batch is retried row by row, so one bad row cannot block the others. A row that fails
// PoisonAfter times is set aside (poisoned_at) and raises the backlog alert.

package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Relay tuning.
const (
	RelayBatch  = 200
	PoisonAfter = 5
	Retention   = 7 * 24 * time.Hour
	// relaySweep — a NOTIFY lost during a listener reconnect costs at most this much latency.
	relaySweep   = time.Minute
	relayBackoff = 2 * time.Second
	// relayBackoffDoublings —— past this many failures in a row the wait stops doubling (it is
	// capped at relaySweep long before).
	relayBackoffDoublings = 5
	retentionTick         = time.Hour
)

type claimed struct {
	id, typ, subject string
	seq              int64
}

// fanKey —— one job per key: (subscriber, subject) for a coalescing subscriber, (subscriber, event)
// for every other.
type fanKey struct{ sub, group string }

// FanOut — one relay pass. Returns how many events it fanned out.
func (b *Bus) FanOut(ctx context.Context, j jobs.Jobs) (int, error) {
	var rows []claimed
	err := pgstore.InTx(ctx, b.pool, func(tx pgstore.Tx) error {
		var cerr error
		rows, cerr = collectClaimed(tx.Query(ctx, claimSelect+`WHERE fanned_out_at IS NULL
			AND poisoned_at IS NULL ORDER BY seq LIMIT $1 FOR UPDATE SKIP LOCKED`, RelayBatch))
		if cerr != nil {
			return cerr
		}
		return b.fanOutRows(ctx, tx, j, rows)
	})
	n := len(rows)
	if err == nil {
		b.announce(ctx, rows)
		return n, nil
	}
	if n > 1 {
		b.log.Warn("events: relay batch failed, retrying row by row", "err", err)
		return b.fanOutOneByOne(ctx, j)
	}
	if n == 1 {
		b.recordFailure(ctx, err)
	}
	return 0, fmt.Errorf("relay pass: %w", err)
}

// AwaitFanout — waits up to maxWait for an event to be fanned out, and returns the job the given
// subscriber got. ok=false: not fanned in time, the subscriber did not match, or too many waiters.
func (b *Bus) AwaitFanout(
	ctx context.Context, eventID, subscriber string, maxWait time.Duration,
) (jobs.JobID, bool) {
	w, ok := b.fanned.Register(eventID)
	if !ok {
		return 0, false
	}
	defer w.Release()
	timer := time.NewTimer(maxWait)
	defer timer.Stop()
	ev, ok := b.awaitFanned(ctx, eventID, w, timer.C)
	if !ok {
		return 0, false
	}
	for _, t := range ev.Fanout {
		if t.Subscriber == subscriber {
			return t.JobID, true
		}
	}
	return 0, false
}

// LatestFor — the newest event of a type whose data[key] equals value ("" when none).
func (b *Bus) LatestFor(ctx context.Context, typ, key, value string) (string, error) {
	var id string
	err := b.pool.QueryRow(ctx, `SELECT id::text FROM events WHERE type = $1 AND data->>$2 = $3
		ORDER BY seq DESC LIMIT 1`, typ, key, value).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("latest event: %w", err)
	}
	return id, nil
}

// Requeue — puts a poisoned event back in line (the panel's retry for a stuck event).
func (b *Bus) Requeue(ctx context.Context, id string) error {
	tag, err := b.pool.Exec(ctx, `UPDATE events SET poisoned_at = NULL, relay_failures = 0
		WHERE id = $1 AND fanned_out_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("requeue event: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	b.poke()
	return nil
}

// fanOutRows — enqueue and stamp, inside the caller's transaction.
func (b *Bus) fanOutRows(ctx context.Context, tx pgstore.Tx, j jobs.Jobs, rows []claimed) error {
	latest, order := b.latestBySubject(rows)
	jobOf := make(map[fanKey]jobs.JobID, len(order))
	jt := j.With(tx)
	for _, k := range order {
		args := JobArgs{EventID: latest[k].id, Subject: latest[k].subject}
		id, err := jt.Enqueue(ctx, k.sub, args, jobs.EnqueueOpts{})
		if err != nil {
			return fmt.Errorf("fan out %s to %s: %w", latest[k].id, k.sub, err)
		}
		jobOf[k] = id
	}
	for _, r := range rows {
		if err := b.stamp(ctx, tx, r, jobOf); err != nil {
			return err
		}
	}
	return nil
}

// latestBySubject — per fan key, the latest row, and the keys in first-seen order.
func (b *Bus) latestBySubject(rows []claimed) (map[fanKey]claimed, []fanKey) {
	latest := map[fanKey]claimed{}
	order := []fanKey{}
	for _, r := range rows {
		for _, sub := range b.subscribersOf(r.typ) {
			k := b.keyFor(sub, r)
			if _, ok := latest[k]; !ok {
				order = append(order, k)
			}
			latest[k] = r // rows arrive in seq order, so the last one wins
		}
	}
	return latest, order
}

// keyFor — the fan key of row r for subscriber sub.
func (b *Bus) keyFor(sub string, r claimed) fanKey {
	for i := range b.subs {
		if b.subs[i].Name == sub && b.subs[i].Coalesce {
			return fanKey{sub, r.subject}
		}
	}
	return fanKey{sub, r.id}
}

// subscribersOf — the names of the subscriptions that match typ, in declaration order.
func (b *Bus) subscribersOf(typ string) []string {
	out := []string{}
	for i := range b.subs {
		if b.subs[i].matches(typ) {
			out = append(out, b.subs[i].Name)
		}
	}
	return out
}

// stamp — marks one row fanned out, with the job each matching subscriber got.
func (b *Bus) stamp(
	ctx context.Context, tx pgstore.Tx, r claimed, jobOf map[fanKey]jobs.JobID,
) error {
	subs := b.subscribersOf(r.typ)
	targets := make([]Target, 0, len(subs))
	for _, sub := range subs {
		targets = append(targets, Target{Subscriber: sub, JobID: jobOf[b.keyFor(sub, r)]})
	}
	raw, err := json.Marshal(targets)
	if err != nil {
		return fmt.Errorf("encode fanout of %s: %w", r.id, err)
	}
	if _, err = tx.Exec(ctx, `UPDATE events SET fanned_out_at = now(), fanout = $2, last_error = ''
		WHERE id = $1`, r.id, raw); err != nil {
		return fmt.Errorf("stamp event %s: %w", r.id, err)
	}
	return nil
}

func (b *Bus) fanOutOneByOne(ctx context.Context, j jobs.Jobs) (int, error) {
	rs, err := b.pool.Query(ctx, `SELECT id FROM events
		WHERE fanned_out_at IS NULL AND poisoned_at IS NULL ORDER BY seq LIMIT $1`, RelayBatch)
	if err != nil {
		return 0, fmt.Errorf("list unfanned: %w", err)
	}
	ids, err := pgx.CollectRows(rs, pgx.RowTo[string])
	if err != nil {
		return 0, fmt.Errorf("list unfanned: %w", err)
	}
	n := 0
	for _, id := range ids {
		if b.fanOutOne(ctx, j, id) {
			n++
		}
	}
	return n, nil
}

// fanOutOne — one row in its own transaction. A failure counts against the row; true when this
// pass fanned it out.
func (b *Bus) fanOutOne(ctx context.Context, j jobs.Jobs, id string) bool {
	var got bool
	err := pgstore.InTx(ctx, b.pool, func(tx pgstore.Tx) error {
		rows, cerr := collectClaimed(tx.Query(ctx, claimSelect+`WHERE id = $1
			AND fanned_out_at IS NULL AND poisoned_at IS NULL FOR UPDATE SKIP LOCKED`, id))
		if cerr != nil || len(rows) == 0 {
			return cerr
		}
		got = true
		return b.fanOutRows(ctx, tx, j, rows)
	})
	if err != nil {
		b.markFailed(ctx, id, err)
		return false
	}
	if got {
		b.announce(ctx, []claimed{{id: id}})
	}
	return got
}

// announce — after the commit: tells waiters in every process that these events have their jobs.
func (b *Bus) announce(ctx context.Context, rows []claimed) {
	if len(rows) == 0 {
		return
	}
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.id)
	}
	if err := pgstore.Notify(ctx, b.pool, FannedChannel, ids...); err != nil {
		b.log.Warn("events: announce fan-out", "err", err)
	}
}

// awaitFanned — re-reads the event on every wake-up until it is fanned out. false when the read
// fails, the timeout fires or ctx ends first.
func (b *Bus) awaitFanned(
	ctx context.Context, eventID string, w pgstore.Waiter, timeout <-chan time.Time,
) (Event, bool) {
	for {
		ev, err := b.Get(ctx, eventID)
		if err != nil {
			return Event{}, false
		}
		if ev.FannedOutAt != nil {
			return ev, true
		}
		if !w.Await(ctx, timeout) {
			return Event{}, false
		}
	}
}

// recordFailure — a single-row batch failed; count it against whichever row is first in line.
func (b *Bus) recordFailure(ctx context.Context, err error) {
	var id string
	if qerr := b.pool.QueryRow(ctx, `SELECT id FROM events
		WHERE fanned_out_at IS NULL AND poisoned_at IS NULL
		ORDER BY seq LIMIT 1`).Scan(&id); qerr == nil {
		b.markFailed(ctx, id, err)
	}
}

func (b *Bus) markFailed(ctx context.Context, id string, cause error) {
	if _, err := b.pool.Exec(ctx, `UPDATE events
		SET relay_failures = relay_failures + 1, last_error = $2,
		poisoned_at = CASE WHEN relay_failures + 1 >= $3 THEN now() END WHERE id = $1`,
		id, cause.Error(), PoisonAfter); err != nil {
		b.log.Warn("events: mark relay failure", "event", id, "err", err)
	}
}

// matches — whether any of s's globs matches typ.
func (s *Subscription) matches(typ string) bool {
	for _, g := range s.Types {
		if Match(g, typ) {
			return true
		}
	}
	return false
}

// claimSelect — the columns a claim reads; the caller appends its WHERE.
const claimSelect = `SELECT id, seq, type, subject FROM events `

// collectClaimed — the rows of a claim query.
func collectClaimed(rs pgx.Rows, err error) ([]claimed, error) {
	if err != nil {
		return nil, fmt.Errorf("claim events: %w", err)
	}
	out, err := pgx.CollectRows(rs, func(r pgx.CollectableRow) (claimed, error) {
		var c claimed
		return c, r.Scan(&c.id, &c.seq, &c.typ, &c.subject)
	})
	if err != nil {
		return nil, fmt.Errorf("claim events: %w", err)
	}
	return out, nil
}
