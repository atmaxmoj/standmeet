// run.go — the running relay and retention.

package events

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
)

// Start — runs the relay loop until Stop: woken by NOTIFY, or by the periodic sweep.
func (b *Bus) Start(ctx context.Context, j jobs.Jobs) {
	lctx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	b.stop = cancel
	b.done = make(chan struct{})
	w, _ := b.relayWake.Register("") // the relay's own, permanent waiter
	var listeners sync.WaitGroup
	listeners.Go(func() { b.relayWake.Run(lctx) })
	listeners.Go(func() { b.fanned.Run(lctx) })
	go func() {
		defer close(b.done)
		defer listeners.Wait()
		defer w.Release()
		b.loop(lctx, j, w.Wake)
	}()
}

// Stop — stops the relay and waits for its current pass.
func (b *Bus) Stop() {
	if b.stop == nil {
		return
	}
	b.stop()
	<-b.done
	b.stop = nil
}

// PruneOlderThan — deletes fanned-out events older than d. Unfanned and poisoned rows stay: they
// are the backlog, and deleting them would lose events.
func (b *Bus) PruneOlderThan(ctx context.Context, d time.Duration) (int64, error) {
	tag, err := b.pool.Exec(ctx, `DELETE FROM events
		WHERE fanned_out_at IS NOT NULL AND occurred_at < now() - $1::interval`, d.String())
	if err != nil {
		return 0, fmt.Errorf("prune events: %w", err)
	}
	return tag.RowsAffected(), nil
}

// Periodics — the bus's own periodic jobs: retention, and the relay sweep. The sweep only wakes
// the relay; the relay itself stays the one path that fans out.
func (b *Bus) Periodics() []jobs.Periodic {
	return []jobs.Periodic{
		{Name: "events retention", Every: retentionTick, Run: func(ctx context.Context) error {
			_, err := b.PruneOlderThan(ctx, Retention)
			return err
		}},
		{Name: "events relay sweep", Every: relaySweep, Run: func(context.Context) error {
			b.poke()
			return nil
		}},
	}
}

func (b *Bus) poke() { b.relayWake.Wake("") }

// loop — drains, then waits for a wake-up: a NOTIFY from a trigger or Record, or the periodic
// sweep (Periodics) that covers a NOTIFY lost while the listener was reconnecting.
func (b *Bus) loop(ctx context.Context, j jobs.Jobs, wake <-chan struct{}) {
	fails := 0
	for {
		fails = b.drain(ctx, j, fails)
		select {
		case <-ctx.Done():
			return
		case <-wake:
		}
	}
}

// drain — passes until a batch comes back short. A failing pass backs off, then pokes itself so
// it is retried without waiting for the next event. The wait doubles with each failure in a row
// (capped at the sweep interval), so a database that refuses writes is not hammered. Returns the
// failures in a row so far (0 after a good pass).
func (b *Bus) drain(ctx context.Context, j jobs.Jobs, fails int) int {
	for ctx.Err() == nil {
		n, err := b.FanOut(ctx, j)
		if err != nil {
			b.log.Warn("events: relay pass", "err", err)
			sleep(ctx, min(relayBackoff<<min(fails, relayBackoffDoublings), relaySweep))
			b.poke()
			return fails + 1
		}
		if n < RelayBatch {
			return 0
		}
	}
	return fails
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}
