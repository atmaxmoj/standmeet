package river_test

// The contract, part 4: periodic jobs, the worker lifecycle, and declaration errors.

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
)

const (
	periodicDeadline = 10 * time.Second
	smallPoolConns   = 10
)

// waitRuns — polls until runs reaches n or the deadline passes.
func waitRuns(runs *atomic.Int32, n int32, deadline time.Time) {
	for runs.Load() < n && time.Now().Before(deadline) {
		time.Sleep(pollEvery)
	}
}

// waitPeriodicRecord — polls until the single periodic job has a completed last run.
func waitPeriodicRecord(t *testing.T, rt jobs.Runtime, deadline time.Time) jobs.PeriodicState {
	t.Helper()
	for time.Now().Before(deadline) {
		ps, err := rt.Periodic(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if completedOnce(ps) {
			return ps[0]
		}
		time.Sleep(pollEvery)
	}
	return jobs.PeriodicState{}
}

// completedOnce — exactly one periodic job, and its last run completed.
func completedOnce(ps []jobs.PeriodicState) bool {
	return len(ps) == 1 && ps[0].LastRunAt != nil && ps[0].LastResult == jobs.StateCompleted
}

// recordComplete — the state carries a last run, a next run, and the declared period.
func recordComplete(p *jobs.PeriodicState) bool {
	return p.LastRunAt != nil && p.NextRunAt != nil && p.Every == time.Hour
}

// sameLastRun — exactly one periodic job, whose last run is the given one.
func sameLastRun(ps []jobs.PeriodicState, last *time.Time) bool {
	return len(ps) == 1 && ps[0].LastRunAt != nil && ps[0].LastRunAt.Equal(*last)
}

func TestPeriodicRunsAtStartAndKeepsItsRecordAcrossRestarts(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	var runs atomic.Int32
	p := jobs.Periodic{Name: "sweep", Every: time.Hour, Run: func(context.Context) error {
		runs.Add(1)
		return nil
	}}
	rt := start(t, pool, nil, []jobs.Periodic{p})
	deadline := time.Now().Add(periodicDeadline)
	waitRuns(&runs, 1, deadline)
	if runs.Load() == 0 {
		t.Fatal("periodic job did not run at start")
	}
	first := waitPeriodicRecord(t, rt, deadline)
	if !recordComplete(&first) {
		t.Fatalf("periodic state = %+v", first)
	}
	if err := rt.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	assertRestartKnowsLastRun(t, pool, p.Run, first.LastRunAt)
}

// assertRestartKnowsLastRun — a new runtime on the same database (a restart) still knows the
// earlier run.
func assertRestartKnowsLastRun(
	t *testing.T, pool *pgxpool.Pool, run func(context.Context) error, last *time.Time,
) {
	t.Helper()
	again := []jobs.Periodic{{Name: "sweep", Every: time.Hour, Run: run}}
	rt2, err := jobsriver.New(pool, nil, again, jobsriver.Options{})
	if err != nil {
		t.Fatal(err)
	}
	ps, err := rt2.Periodic(context.Background())
	if err != nil || !sameLastRun(ps, last) {
		t.Fatalf("after restart: %+v (%v), want last run %v", ps, err, last)
	}
}

func TestRunPeriodicNowRecordsANewRun(t *testing.T) {
	t.Parallel()
	var runs atomic.Int32
	p := jobs.Periodic{Name: "p", Every: time.Hour, Run: func(context.Context) error {
		runs.Add(1)
		return nil
	}}
	rt := start(t, scratchDB(t), nil, []jobs.Periodic{p})
	deadline := time.Now().Add(periodicDeadline)
	waitRuns(&runs, 1, deadline)
	if err := rt.RunPeriodic(context.Background(), "p"); err != nil {
		t.Fatal(err)
	}
	waitRuns(&runs, 2, deadline)
	if runs.Load() != 2 {
		t.Fatalf("runs = %d, want 2", runs.Load())
	}
	if err := rt.RunPeriodic(context.Background(), "no-such"); err == nil {
		t.Fatal("RunPeriodic of an undeclared name succeeded")
	}
}

func TestStopWaitsForRunningJobsWithinTheGrace(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	started := make(chan struct{})
	var finished atomic.Bool
	rt := start(t, pool, []jobs.Kind{kind("drain", jobs.QueueIndex, 1,
		func(context.Context, json.RawMessage) error {
			close(started)
			time.Sleep(300 * time.Millisecond)
			finished.Store(true)
			return nil
		})}, nil)
	id := enqueue(t, rt, "drain")
	<-started
	if err := rt.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !finished.Load() {
		t.Fatal("Stop returned before the running job finished within the grace")
	}
	var state string
	if err := pool.QueryRow(context.Background(), `SELECT state FROM river_job WHERE id=$1`,
		int64(id)).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "completed" {
		t.Fatalf("state after graceful stop = %s", state)
	}
}

func TestPoolTooSmallForTheWorkersRefusesToStart(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	cfg := pool.Config().Copy()
	cfg.MaxConns = smallPoolConns
	small, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer small.Close()
	if _, err = jobsriver.New(small, nil, nil, jobsriver.Options{}); err == nil {
		t.Fatal("New accepted a pool whose half cannot hold every worker plus the relay")
	}
}

func TestKindDeclarationErrorsSurfaceAtConstruction(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	bad := []jobs.Kind{
		{Name: "", Queue: jobs.QueueIndex, MaxAttempts: 1, Timeout: time.Second, Handle: noop},
		{Name: "q", Queue: "nope", MaxAttempts: 1, Timeout: time.Second, Handle: noop},
		{Name: "a", Queue: jobs.QueueIndex, MaxAttempts: 0, Timeout: time.Second, Handle: noop},
		{Name: "h", Queue: jobs.QueueIndex, MaxAttempts: 1, Timeout: time.Second},
	}
	for _, k := range bad {
		if _, err := jobsriver.New(pool, []jobs.Kind{k}, nil, jobsriver.Options{}); err == nil {
			t.Fatalf("kind %+v accepted", k.Name)
		}
	}
	dup := kind("same", jobs.QueueIndex, 1, noop)
	if _, err := jobsriver.New(pool, []jobs.Kind{dup, dup}, nil, jobsriver.Options{}); err == nil {
		t.Fatal("duplicate kind accepted")
	}
}

func TestDefaultBackoffDoublesFromOneSecondAndCaps(t *testing.T) {
	t.Parallel()
	const (
		thirdBackoff       = 4 * time.Second
		tenthAttempt       = 10
		tenthBackoff       = 512 * time.Second
		firstCappedAttempt = 11
		farAttempt         = 40
		backoffCap         = 15 * time.Minute
	)
	want := map[int]time.Duration{
		1: time.Second, 2: 2 * time.Second, 3: thirdBackoff,
		tenthAttempt: tenthBackoff, firstCappedAttempt: backoffCap, farAttempt: backoffCap,
	}
	for attempt, d := range want {
		if got := jobs.DefaultBackoff(attempt); got != d {
			t.Fatalf("DefaultBackoff(%d) = %s, want %s", attempt, got, d)
		}
	}
}
