package ops_test

// Saturation: a backlog surge (docs/design/event-bus-outbox-webhooks.md, *Test plan* ›
// "Saturation and degradation UTs", *Storage bounds*). Real Postgres, the real bus and relay,
// a River runtime built but not started (jobs are rows to count, not work to run), and the
// Tasks panel's own tasks.overview op.

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/stats/ops"
)

const (
	surge        = 2_000
	surgeType    = "corpus.note.changed"
	surgeSubject = "wiki://imported"
	coalescing   = "corpus.index"
	backlogAlert = "events_backlog"
	subTimeout   = 5 * time.Second
	// jobBound —— one relay pass claims RelayBatch rows and coalesces one subject to one job, so
	// a same-subject surge yields at most one job per batch.
	jobBound = (surge + events.RelayBatch - 1) / events.RelayBatch
)

//nolint:ireturn // the port is what the panel reads jobs through
func surgeBus(t *testing.T) (*events.Bus, jobs.Runtime) {
	t.Helper()
	pool := scratchDB(t)
	sub := events.Subscription{
		Name: coalescing, Types: []string{surgeType}, Queue: jobs.QueueIndex, MaxAttempts: 1,
		Timeout: subTimeout, Coalesce: true,
		Handle: func(context.Context, events.Event) error { return nil },
	}
	bus, err := events.New(pool, []events.Type{{Type: surgeType}}, []events.Subscription{sub})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err = jobsriver.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	rt, err := jobsriver.New(pool, bus.Kinds(), nil, jobsriver.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err = pgstore.InTx(ctx, pool, func(tx pgstore.Tx) error {
		return recordSurge(ctx, bus.Recorder().With(tx))
	}); err != nil {
		t.Fatal(err)
	}
	return bus, rt
}

// recordSurge —— `surge` changes to one subject.
func recordSurge(ctx context.Context, rec events.Recorder) error {
	for i := range surge {
		if err := rec.Record(ctx, "", surgeType, surgeSubject, map[string]int{"v": i}); err != nil {
			return err
		}
	}
	return nil
}

// alerts —— the alerts tasks.overview shows right now.
func alerts(t *testing.T, d ops.TasksDeps) []string {
	t.Helper()
	raw, err := overviewOp(t, ops.Tasks(d)).Invoke(context.Background(), "", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Alerts []string `json:"alerts"`
	}
	if err = json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out.Alerts
}

func overviewOp(t *testing.T, all []fp.Op) *fp.Op {
	t.Helper()
	for i := range all {
		if all[i].ID == "tasks.overview" {
			return &all[i]
		}
	}
	t.Fatal("no tasks.overview op")
	return nil
}

// jobsMade —— the coalescing subscriber's queued jobs.
func jobsMade(t *testing.T, rt jobs.Runtime) int {
	t.Helper()
	ov, err := rt.Overview(context.Background(), coalescing)
	if err != nil {
		t.Fatal(err)
	}
	return ov.Counts[jobs.StatePending]
}

// relayUntilDrained —— relay passes until one fans out nothing.
func relayUntilDrained(t *testing.T, bus *events.Bus, j jobs.Jobs) {
	t.Helper()
	for {
		n, err := bus.FanOut(context.Background(), j)
		if err != nil {
			t.Fatalf("relay pass: %v", err)
		}
		if n == 0 {
			return
		}
	}
}

// TestABacklogSurgeCoalescesAndRaisesTheAlertUntilDrained — 2,000 changes to one subject (a bulk
// import): the panel alerts while the unfanned backlog is over its threshold; draining it makes
// at most one job per relay batch for the coalescing subscriber, and the alert clears.
func TestABacklogSurgeCoalescesAndRaisesTheAlertUntilDrained(t *testing.T) {
	t.Parallel()
	bus, rt := surgeBus(t)
	d := ops.TasksDeps{Jobs: rt, Events: bus}
	if got := alerts(t, d); !slices.Contains(got, backlogAlert) {
		t.Fatalf("alerts with %d unfanned events = %v, want %s", surge, got, backlogAlert)
	}
	relayUntilDrained(t, bus, rt)
	if n := jobsMade(t, rt); n < 1 || n > jobBound {
		t.Fatalf("%d same-subject changes made %d jobs, want 1..%d", surge, n, jobBound)
	}
	if got := alerts(t, d); slices.Contains(got, backlogAlert) {
		t.Fatalf("alerts after draining = %v, want %s cleared", got, backlogAlert)
	}
}
