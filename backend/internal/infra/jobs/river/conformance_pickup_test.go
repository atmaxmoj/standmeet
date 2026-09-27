package river_test

// A job a request waits on (a write's index receipt, a mail receipt) is picked up at once, even
// when River's insert notification for it was swallowed. River sends one insert notification per
// queue per FetchCooldown: a second insert just after the first sends none, and if the worker
// already fetched after the first, the second waits for the next poll. With the default 1 s poll
// that was ~0.5 s per write (docs/design/event-bus-outbox-webhooks.md, *Response contract*).
//
// Built with the production Options (no test poll interval): the shared start() shortens
// polling, which is exactly what hid this.

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
)

const (
	// pickupBound —— insert to completed for a waited-on job: the awaited-queue poll (100 ms) plus
	// River's batch completer, which records completions every 250 ms (jobcompleter
	// job_completer.go, not configurable), plus slack. The swallowed-notification case took ~1 s.
	pickupBound = 600 * time.Millisecond
	// insertGap —— the gap between a write's two index jobs (raw, then wiki), as measured.
	insertGap = 5 * time.Millisecond
)

func TestAWaitedOnQueuePicksUpAJobWhoseNotificationWasSwallowed(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	if err := jobsriver.Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	for q := range jobs.QueueAwaited {
		pickupWithinBound(t, pool, q)
	}
}

// pickupWithinBound —— on queue q, a job inserted insertGap after another runs within pickupBound.
func pickupWithinBound(t *testing.T, pool *pgxpool.Pool, q string) {
	t.Helper()
	ctx := context.Background()
	k := "k-" + q
	rt, err := jobsriver.New(pool, []jobs.Kind{kind(k, q, 1, noop)}, nil, jobsriver.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err = rt.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rt.Stop(ctx) }() //nolint:errcheck // the outcome is asserted above
	for range 3 {
		enqueue(t, rt, k) // its notification wakes the worker, which fetches it
		time.Sleep(insertGap)
		start := time.Now()
		waitState(t, rt, enqueue(t, rt, k), jobs.StateCompleted) // sends no notification
		if took := time.Since(start); took > pickupBound {
			t.Errorf("queue %s: a job inside the notify window ran after %v, want < %v",
				q, took, pickupBound)
		}
	}
}
