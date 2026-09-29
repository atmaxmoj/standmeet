package ops_test

// A poisoned event can be put back in line from the Tasks panel (docs/design/event-bus-outbox-
// webhooks.md, *Message loss*: "real failures go to the panel, and can be retried by hand").

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/stats/ops"
)

// refusingJobs —— a jobs port whose every enqueue fails, so the relay poisons what it claims.
type refusingJobs struct{ jobs.Jobs }

func (f refusingJobs) With(tx pgstore.Tx) jobs.Jobs { return refusingJobs{f.Jobs.With(tx)} }

func (refusingJobs) Enqueue(
	context.Context, string,
	pgstore.JSONB,
	jobs.EnqueueOpts,
) (jobs.JobID, error) {
	return 0, errors.New("enqueue refused")
}

// oneEventBus —— the bus and an unstarted runtime, with a single unfanned event.
func oneEventBus(t *testing.T) (*events.Bus, jobs.Runtime) {
	t.Helper()
	pool := scratchDB(t)
	sub := events.Subscription{
		Name: coalescing, Types: []string{surgeType}, Queue: jobs.QueueIndex, MaxAttempts: 1,
		Timeout: subTimeout, Handle: func(context.Context, events.Event) error { return nil },
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
		return bus.Recorder().With(tx).Record(ctx, "", surgeType, surgeSubject, map[string]int{})
	}); err != nil {
		t.Fatal(err)
	}
	return bus, rt
}

func invokeOp(t *testing.T, all []fp.Op, id, args string) {
	t.Helper()
	for i := range all {
		if all[i].ID == id {
			_, err := all[i].Invoke(context.Background(), "", json.RawMessage(args))
			if err != nil {
				t.Fatalf("%s: %v", id, err)
			}
			return
		}
	}
	t.Fatalf("no %s op", id)
}

// refusedPass —— one relay pass against a refusing queue. Failure is the input, so a failed
// pass is logged, not asserted.
func refusedPass(ctx context.Context, t *testing.T, bus *events.Bus, rt jobs.Jobs) {
	t.Helper()
	if _, err := bus.FanOut(ctx, refusingJobs{rt}); err != nil {
		t.Logf("relay pass failed, as designed: %v", err)
	}
}

// poisonTheEvent ——relay passes against a refusing queue until the bus's one event is poisoned;
// returns its id.
func poisonTheEvent(t *testing.T, bus *events.Bus, rt jobs.Jobs) string {
	t.Helper()
	ctx := context.Background()
	for range events.PoisonAfter + 1 {
		refusedPass(ctx, t, bus, rt)
	}
	stuck, err := bus.List(ctx, events.Filter{Limit: 1})
	if err != nil || len(stuck) != 1 || !stuck[0].Poisoned {
		t.Fatalf("setup: want a poisoned event, got %+v (%v)", stuck, err)
	}
	return stuck[0].ID
}

func TestEventsRequeuePutsAPoisonedEventBackAndItFansOut(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	bus, rt := oneEventBus(t)
	id := poisonTheEvent(t, bus, rt)
	all := ops.Events(ops.TasksDeps{Jobs: rt, Events: bus})
	invokeOp(t, all, "events.requeue", `{"id":"`+id+`"}`)
	relayUntilDrained(t, bus, rt)
	ev, err := bus.Get(ctx, id)
	if err != nil || ev.Poisoned || ev.FannedOutAt == nil {
		t.Fatalf("after requeue: event = %+v (%v), want fanned out and no longer poisoned", ev, err)
	}
}
