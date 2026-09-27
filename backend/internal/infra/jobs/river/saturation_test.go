package river_test

// Saturation: the connection pool (docs/design/event-bus-outbox-webhooks.md, *Test plan* ›
// "Saturation and degradation UTs", *Concurrency and goroutines* › connection budget).

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
)

const (
	starvedTimeout  = 200 * time.Millisecond
	starvedAttempts = 10
	tinyPoolConns   = 2
	// requestConns —— request-path connections taken while every worker holds one. Half the pool
	// is the reserve; River keeps two of it (its notifier and the completion listener) and borrows
	// a few more for fetches, so 15 of the 20 is the reserve a visitor can count on.
	requestConns = 15
	requestWait  = 2 * time.Second
)

// holdAll —— takes n connections of pool and keeps them until the returned release is called.
func holdAll(t *testing.T, pool *pgxpool.Pool, n int) func() {
	t.Helper()
	held := make([]*pgxpool.Conn, 0, n)
	for range n {
		c, err := pool.Acquire(context.Background())
		if err != nil {
			t.Fatalf("hold connection: %v", err)
		}
		held = append(held, c)
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			for _, c := range held {
				c.Release()
			}
		})
	}
	t.Cleanup(release)
	return release
}

// TestAJobThatCannotGetAConnectionTurnsRetryable — every connection of the pool the job works on
// is held: the job's wait ends at its timeout and the attempt counts as retryable, not a crash;
// once connections free up, the retry completes.
func TestAJobThatCannotGetAConnectionTurnsRetryable(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	cfg := pool.Config().Copy()
	cfg.MaxConns = tinyPoolConns
	work, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(work.Close)
	release := holdAll(t, work, tinyPoolConns)
	k := kind("starved", jobs.QueueIndex, starvedAttempts,
		func(ctx context.Context, _ json.RawMessage) error {
			c, aerr := work.Acquire(ctx)
			if aerr != nil {
				return aerr
			}
			c.Release()
			return nil
		})
	k.Timeout = starvedTimeout
	rt := start(t, pool, []jobs.Kind{k}, nil)
	id := enqueue(t, rt, "starved")
	j := waitState(t, rt, id, jobs.StateRetryable)
	if len(j.Errors) == 0 || !strings.Contains(j.Errors[0].Error, "deadline exceeded") {
		t.Fatalf("errors = %v, want the connection wait cut off by the job timeout", j.Errors)
	}
	release()
	waitState(t, rt, id, jobs.StateCompleted)
}

// busyWorkers —— one kind per queue whose handler holds a connection of pool until done closes.
func busyWorkers(pool *pgxpool.Pool, done <-chan struct{}) []jobs.Kind {
	out := make([]jobs.Kind, 0, len(jobs.QueueWorkers))
	for q := range jobs.QueueWorkers {
		out = append(out, kind("hold-"+q, q, 1, func(ctx context.Context, _ json.RawMessage) error {
			c, err := pool.Acquire(ctx)
			if err != nil {
				return err
			}
			defer c.Release()
			<-done
			return nil
		}))
	}
	return out
}

// occupyEveryWorker —— enqueues one busy job per worker of every queue and waits until each
// holds its connection.
func occupyEveryWorker(t *testing.T, rt jobs.Runtime, pool *pgxpool.Pool) {
	t.Helper()
	var workers int32
	for q, n := range jobs.QueueWorkers {
		for range n {
			enqueue(t, rt, "hold-"+q)
			workers++
		}
	}
	deadline := time.Now().Add(waitDeadline)
	for pool.Stat().AcquiredConns() < workers {
		if time.Now().After(deadline) {
			t.Fatalf("acquired %d connections, want %d busy workers",
				pool.Stat().AcquiredConns(), workers)
		}
		time.Sleep(pollEvery)
	}
}

// overlappingQueries —— requestConns request-path queries that each hold a connection at once;
// the first error, if any.
func overlappingQueries(pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(context.Background(), requestWait)
	defer cancel()
	var wg sync.WaitGroup
	errs := make(chan error, requestConns)
	for range requestConns {
		wg.Go(func() {
			var one int
			errs <- pool.QueryRow(ctx, `SELECT 1 FROM pg_sleep(0.3)`).Scan(&one)
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

// TestRequestsKeepTheReserveWhileEveryWorkerHoldsAConnection — every worker of every queue is busy
// holding a connection of the shared pool (the worst case the boot budget allows): request-path
// queries still get connections at once, from the half the budget keeps for them.
func TestRequestsKeepTheReserveWhileEveryWorkerHoldsAConnection(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	done := make(chan struct{})
	defer close(done)
	rt := start(t, pool, busyWorkers(pool, done), nil)
	occupyEveryWorker(t, rt, pool)
	if err := overlappingQueries(pool); err != nil {
		t.Fatalf("a request-path query found no connection while workers were busy: %v", err)
	}
}
