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
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
)

const (
	// pickupBound —— insert to the handler starting, for a waited-on job: the awaited-queue poll
	// (100 ms) plus slack. The swallowed-notification case took ~1 s (the default poll).
	pickupBound = 400 * time.Millisecond
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

// stopRuntime —— stops rt; a failed stop fails the test.
func stopRuntime(ctx context.Context, t *testing.T, rt jobs.Runtime) {
	t.Helper()
	if err := rt.Stop(ctx); err != nil {
		t.Error(err)
	}
}

// pickupWithinBound ——on queue q, a job inserted insertGap after another runs within pickupBound.
func pickupWithinBound(t *testing.T, pool *pgxpool.Pool, q string) {
	t.Helper()
	ctx := context.Background()
	k := "k-" + q
	started := make(chan struct{}, 2)
	run := func(context.Context, json.RawMessage) error { started <- struct{}{}; return nil }
	rt, err := jobsriver.New(pool, []jobs.Kind{kind(k, q, 1, run)}, nil, jobsriver.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err = rt.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer stopRuntime(ctx, t, rt)
	for range 3 {
		enqueue(t, rt, k) // its notification wakes the worker, which fetches it
		time.Sleep(insertGap)
		begin := time.Now()
		enqueue(t, rt, k) // sends no notification
		if took := secondStart(t, started); took.Sub(begin) > pickupBound {
			t.Errorf("queue %s: a job inside the notify window started after %v, want < %v",
				q, took.Sub(begin), pickupBound)
		}
	}
}

// secondStart —— when the second of the two jobs began running. Timed at the handler, not at
// "completed": River records completions in 250 ms batches, and under -race on a loaded CI box
// that batch was the whole margin (864 ms observed against a 600 ms bound).
func secondStart(t *testing.T, started <-chan struct{}) time.Time {
	t.Helper()
	for i := range 2 {
		select {
		case <-started:
		case <-time.After(10 * time.Second):
			t.Fatalf("job %d of 2 never started", i+1)
		}
	}
	return time.Now()
}
