package river_test

// The contract, part 3: waiting on a job, and the Inspector the Tasks panel reads.

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
)

const (
	atOnce         = 200 * time.Millisecond
	minPendingAge  = 200 * time.Millisecond
	waiterPatience = 3 * time.Second
)

func TestWaitReturnsTheTerminalState(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	rt := start(t, scratchDB(t), []jobs.Kind{kind("gated", jobs.QueueIndex, 1,
		func(context.Context, json.RawMessage) error {
			<-release
			return nil
		})}, nil)
	id := enqueue(t, rt, "gated")
	if st, ok := rt.Wait(context.Background(), id, 100*time.Millisecond); ok {
		t.Fatalf("Wait returned ok=%v state=%s before the job could finish", ok, st)
	}
	close(release)
	st, ok := rt.Wait(context.Background(), id, 5*time.Second)
	if !ok || st != jobs.StateCompleted {
		t.Fatalf("Wait = %s,%v, want completed,true", st, ok)
	}
}

func TestWaitersOverTheCapGetTheirReceiptAtOnce(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	rt := start(t, scratchDB(t), []jobs.Kind{kind("held", jobs.QueueIndex, 1,
		func(context.Context, json.RawMessage) error {
			<-release
			return nil
		})}, nil)
	defer close(release)
	id := enqueue(t, rt, "held")
	var wg sync.WaitGroup
	for range jobsriver.MaxWaiters {
		wg.Go(func() { rt.Wait(context.Background(), id, waiterPatience) })
	}
	waitAllParked(t, rt)
	began := time.Now()
	_, ok := rt.Wait(context.Background(), id, waiterPatience)
	if ok || time.Since(began) > atOnce {
		t.Fatalf("waiter over the cap: ok=%v after %s, want false at once", ok, time.Since(began))
	}
	wg.Wait()
}

// waitAllParked — until MaxWaiters Wait calls are parked; not "probably by now": under -race on a
// loaded CI box a fixed 100 ms was not enough, and the extra waiter got a free slot and waited out
// its patience.
func waitAllParked(t *testing.T, rt jobs.Runtime) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for jobsriver.WaitingOn(rt) < jobsriver.MaxWaiters {
		if time.Now().After(deadline) {
			t.Fatalf("only %d of %d waiters parked", jobsriver.WaitingOn(rt), jobsriver.MaxWaiters)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// assertAllMatch — every row has the given kind and state.
func assertAllMatch(t *testing.T, rows []jobs.Job, k string, st jobs.State) {
	t.Helper()
	for i := range rows {
		if rows[i].Kind != k || rows[i].State != st {
			t.Fatalf("row %+v outside the filter", rows[i])
		}
	}
}

func TestListFiltersByKindAndState(t *testing.T) {
	t.Parallel()
	ok := kind("ok", jobs.QueueIndex, 1, noop)
	bad := kind("bad", jobs.QueueIndex, 1,
		func(context.Context, json.RawMessage) error { return errors.New("x") })
	rt := start(t, scratchDB(t), []jobs.Kind{ok, bad}, nil)
	waitState(t, rt, enqueue(t, rt, "ok"), jobs.StateCompleted)
	waitState(t, rt, enqueue(t, rt, "bad"), jobs.StateDiscarded)
	waitState(t, rt, enqueue(t, rt, "bad"), jobs.StateDiscarded)
	f := jobs.Filter{Kind: "bad", State: jobs.StateDiscarded}
	got, err := rt.List(context.Background(), f)
	if err != nil || len(got) != 2 {
		t.Fatalf("list = %d rows (%v), want 2", len(got), err)
	}
	assertAllMatch(t, got, "bad", jobs.StateDiscarded)
}

func TestListFiltersByArgsContainment(t *testing.T) {
	t.Parallel()
	const k = "deliver"
	rt := start(t, scratchDB(t), []jobs.Kind{kind(k, jobs.QueueIndex, 1, noop)}, nil)
	a := enqueueRaw(t, rt, k, json.RawMessage(`{"endpoint_id":"a","event_id":"1"}`))
	enqueueRaw(t, rt, k, json.RawMessage(`{"endpoint_id":"b","event_id":"2"}`))
	a2 := enqueueRaw(t, rt, k, json.RawMessage(`{"endpoint_id":"a","event_id":"3"}`))
	f := jobs.Filter{Args: json.RawMessage(`{"endpoint_id":"a"}`)}
	got, err := rt.List(context.Background(), f)
	if err != nil || len(got) != 2 || got[0].ID != a2 || got[1].ID != a {
		t.Fatalf("list = %+v (%v), want jobs %d and %d, newest first", got, err, a2, a)
	}
}

// overview — the Inspector's overview, failing the test on an error.
func overview(t *testing.T, rt jobs.Runtime, k string) jobs.Overview {
	t.Helper()
	ov, err := rt.Overview(context.Background(), k)
	if err != nil {
		t.Fatal(err)
	}
	return ov
}

// oneCompletedOnePending — one completed, one pending, and the pending one is old enough.
func oneCompletedOnePending(ov *jobs.Overview) bool {
	return ov.Counts[jobs.StateCompleted] == 1 && ov.Counts[jobs.StatePending] == 1 &&
		ov.OldestPendingAge >= minPendingAge
}

func TestOverviewCountsStatesAndOldestPending(t *testing.T) {
	t.Parallel()
	rt := start(t, scratchDB(t), []jobs.Kind{kind("ok", jobs.QueueIndex, 1, noop)}, nil)
	waitState(t, rt, enqueue(t, rt, "ok"), jobs.StateCompleted)
	later := jobs.EnqueueOpts{RunAt: time.Now().Add(time.Hour)}
	if _, err := rt.Enqueue(context.Background(), "ok", nil, later); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	if ov := overview(t, rt, ""); !oneCompletedOnePending(&ov) {
		t.Fatalf("overview = %+v", ov)
	}
	if byKind := overview(t, rt, "nothing-of-this-kind"); byKind.Counts[jobs.StateCompleted] != 0 {
		t.Fatalf("kind filter ignored: %+v", byKind)
	}
}

// A kind that never ran is still one the panel can filter by (a fresh instance has no jobs yet).
func TestOverviewListsEveryDeclaredKindBeforeItRuns(t *testing.T) {
	t.Parallel()
	rt := start(t, scratchDB(t), []jobs.Kind{kind("never-ran", jobs.QueueIndex, 1, noop)}, nil)
	if ov := overview(t, rt, ""); !slices.Contains(ov.Kinds, "never-ran") {
		t.Fatalf("kinds = %v, want the declared kind listed", ov.Kinds)
	}
}

func TestManualRetryRunsADiscardedJobAgain(t *testing.T) {
	t.Parallel()
	var healthy atomic.Bool
	rt := start(t, scratchDB(t), []jobs.Kind{kind("fixme", jobs.QueueNotify, 1,
		func(context.Context, json.RawMessage) error {
			if !healthy.Load() {
				return errors.New("smtp down")
			}
			return nil
		})}, nil)
	id := enqueue(t, rt, "fixme")
	waitState(t, rt, id, jobs.StateDiscarded)
	healthy.Store(true)
	if err := rt.Retry(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	waitState(t, rt, id, jobs.StateCompleted)
}

// A handler's Discard (410 Gone) is retried by hand too: the webhook "re-deliver all".
func TestManualRetryRunsAHandlerDiscardAgain(t *testing.T) {
	t.Parallel()
	var healthy atomic.Bool
	rt := start(t, scratchDB(t), []jobs.Kind{kind("gone", jobs.QueueNotify, 3,
		func(context.Context, json.RawMessage) error {
			if !healthy.Load() {
				return jobs.Discard(errors.New("410 gone"))
			}
			return nil
		})}, nil)
	id := enqueue(t, rt, "gone")
	waitState(t, rt, id, jobs.StateDiscarded)
	healthy.Store(true)
	if err := rt.Retry(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	waitState(t, rt, id, jobs.StateCompleted)
}

// getJob — one job, failing the test on an error.
func getJob(t *testing.T, rt jobs.Runtime, id jobs.JobID) jobs.Job {
	t.Helper()
	j, err := rt.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return j
}

func TestCancelledJobNeverRuns(t *testing.T) {
	t.Parallel()
	var ran atomic.Int32
	rt := start(t, scratchDB(t), []jobs.Kind{kind("later", jobs.QueueIndex, 1,
		func(context.Context, json.RawMessage) error {
			ran.Add(1)
			return nil
		})}, nil)
	soon := jobs.EnqueueOpts{RunAt: time.Now().Add(700 * time.Millisecond)}
	id, err := rt.Enqueue(context.Background(), "later", nil, soon)
	if err != nil {
		t.Fatal(err)
	}
	if err = rt.Cancel(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	sentinel := enqueue(t, rt, "later")
	waitState(t, rt, sentinel, jobs.StateCompleted)
	time.Sleep(time.Second)
	if j := getJob(t, rt, id); j.State != jobs.StateCancelled || ran.Load() != 1 {
		t.Fatalf("cancelled job state=%s, handler runs=%d (want cancelled, only the sentinel)",
			j.State, ran.Load())
	}
}

func TestQueuesDoNotStarveEachOther(t *testing.T) {
	t.Parallel()
	block := make(chan struct{})
	defer close(block)
	hook := kind("hook", jobs.QueueWebhook, 1, func(context.Context, json.RawMessage) error {
		<-block
		return nil
	})
	idx := kind("idx", jobs.QueueIndex, 1, noop)
	rt := start(t, scratchDB(t), []jobs.Kind{hook, idx}, nil)
	for range jobs.QueueWorkers[jobs.QueueWebhook] * 2 {
		enqueue(t, rt, "hook")
	}
	waitState(t, rt, enqueue(t, rt, "idx"), jobs.StateCompleted)
}
