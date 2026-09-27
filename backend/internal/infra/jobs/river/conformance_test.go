package river_test

// The contract of internal/infra/jobs, run against the River implementation. A future
// implementation (Kafka, RabbitMQ, …) must pass these unchanged.
//
// The contract is split across conformance_*_test.go files by concern; the shared helpers live
// here.

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

const (
	fastBackoff  = 20 * time.Millisecond
	pollEvery    = 20 * time.Millisecond
	kindTimeout  = 5 * time.Second
	waitDeadline = 15 * time.Second
	stopGrace    = 2 * time.Second
)

func fast(int) time.Duration { return fastBackoff }

// noop — a handler that always succeeds.
func noop(context.Context, json.RawMessage) error { return nil }

func kind(name, queue string, maxAttempts int, h jobs.Handler) jobs.Kind {
	return jobs.Kind{
		Name: name, Queue: queue, MaxAttempts: maxAttempts,
		Timeout: kindTimeout, Backoff: fast, Handle: h,
	}
}

//nolint:ireturn // the port IS the object under test: the contract runs against jobs.Runtime
func start(
	t *testing.T, pool *pgxpool.Pool, kinds []jobs.Kind, periodics []jobs.Periodic,
) jobs.Runtime {
	t.Helper()
	ctx := context.Background()
	if err := jobsriver.Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	opts := jobsriver.Options{FetchPollInterval: pollEvery, StopGrace: stopGrace}
	rt, err := jobsriver.New(pool, kinds, periodics, opts)
	if err != nil {
		t.Fatalf("new runtime: %v", err)
	}
	if err = rt.Start(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(func() {
		if serr := rt.Stop(context.Background()); serr != nil {
			t.Errorf("stop: %v", serr)
		}
	})
	return rt
}

func waitState(t *testing.T, rt jobs.Runtime, id jobs.JobID, want jobs.State) jobs.Job {
	t.Helper()
	deadline := time.Now().Add(waitDeadline)
	var j jobs.Job
	for time.Now().Before(deadline) {
		var err error
		j, err = rt.Get(context.Background(), id)
		if err == nil && j.State == want {
			return j
		}
		time.Sleep(pollEvery)
	}
	t.Fatalf("job %d state = %q, want %q (errors %v)", id, j.State, want, j.Errors)
	return j
}

// enqueue — a job with no args.
func enqueue(t *testing.T, j jobs.Jobs, k string) jobs.JobID {
	t.Helper()
	id, err := j.Enqueue(context.Background(), k, nil, jobs.EnqueueOpts{})
	if err != nil {
		t.Fatalf("enqueue %s: %v", k, err)
	}
	return id
}

// enqueueRaw — a job whose args are the given JSON bytes.
func enqueueRaw(t *testing.T, j jobs.Jobs, k string, args json.RawMessage) jobs.JobID {
	t.Helper()
	id, err := j.Enqueue(context.Background(), k, args, jobs.EnqueueOpts{})
	if err != nil {
		t.Fatalf("enqueue %s: %v", k, err)
	}
	return id
}

func TestHandlerReceivesExactlyTheEnqueuedArgs(t *testing.T) {
	t.Parallel()
	got := make(chan string, 1)
	echo := kind("echo", jobs.QueueIndex, 1, func(_ context.Context, a json.RawMessage) error {
		got <- string(a)
		return nil
	})
	rt := start(t, scratchDB(t), []jobs.Kind{echo}, nil)
	id := enqueueRaw(t, rt, "echo", json.RawMessage(`{"n":3,"note_id":"n1"}`))
	waitState(t, rt, id, jobs.StateCompleted)
	var m struct {
		NoteID string  `json:"note_id"`
		N      float64 `json:"n"`
	}
	if err := json.Unmarshal([]byte(<-got), &m); err != nil || m.NoteID != "n1" || m.N != 3 {
		t.Fatalf("args = %+v (%v)", m, err)
	}
}

func TestUnknownKindFailsAtEnqueue(t *testing.T) {
	t.Parallel()
	rt := start(t, scratchDB(t), []jobs.Kind{kind("known", jobs.QueueIndex, 1, noop)}, nil)
	_, err := rt.Enqueue(context.Background(), "nobody-declared-me", nil, jobs.EnqueueOpts{})
	if !errors.Is(err, jobs.ErrUnknownKind) {
		t.Fatalf("err = %v, want ErrUnknownKind", err)
	}
}

func TestEnqueueWithTxExistsOnlyIfTheTxCommits(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	var ran atomic.Int32
	rt := start(t, pool, []jobs.Kind{kind("tx", jobs.QueueIndex, 1,
		func(context.Context, json.RawMessage) error {
			ran.Add(1)
			return nil
		})}, nil)
	ctx := context.Background()
	var rolledBack jobs.JobID
	if err := pgstore.InTx(ctx, pool, func(tx pgstore.Tx) error {
		rolledBack = enqueueRaw(t, rt.With(tx), "tx", json.RawMessage(`{"which":"rolled-back"}`))
		return errors.New("abort")
	}); err == nil {
		t.Fatal("aborted transaction reported success")
	}
	var committed jobs.JobID
	if err := pgstore.InTx(ctx, pool, func(tx pgstore.Tx) error {
		committed = enqueueRaw(t, rt.With(tx), "tx", json.RawMessage(`{"which":"committed"}`))
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	waitState(t, rt, committed, jobs.StateCompleted)
	if _, err := rt.Get(ctx, rolledBack); !errors.Is(err, jobs.ErrNotFound) {
		t.Fatalf("rolled-back job: err = %v, want ErrNotFound", err)
	}
	if ran.Load() != 1 {
		t.Fatalf("ran %d times, want exactly the committed one", ran.Load())
	}
}

func TestUniqueByArgsEnqueuesTheSameArgsOnce(t *testing.T) {
	t.Parallel()
	rt := start(t, scratchDB(t), []jobs.Kind{kind("once", jobs.QueueIndex, 1, noop)}, nil)
	first := enqueueUnique(t, rt, `{"e":"1"}`)
	same, other := enqueueUnique(t, rt, `{"e":"1"}`), enqueueUnique(t, rt, `{"e":"2"}`)
	waitState(t, rt, first, jobs.StateCompleted)
	afterDone := enqueueUnique(t, rt, `{"e":"1"}`)
	if same != first || other == first || afterDone != first {
		t.Fatalf("first %d, again %d, other args %d, again after it completed %d: want the same "+
			"args to return the first job and other args a new one", first, same, other, afterDone)
	}
}

// enqueueUnique —— a "once" job with these args, unique by args.
func enqueueUnique(t *testing.T, j jobs.Jobs, args string) jobs.JobID {
	t.Helper()
	opts := jobs.EnqueueOpts{UniqueByArgs: true}
	id, err := j.Enqueue(context.Background(), "once", json.RawMessage(args), opts)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestWithDoesNotAlterTheOriginal(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	rt := start(t, pool, []jobs.Kind{kind("w", jobs.QueueIndex, 1, noop)}, nil)
	ctx := context.Background()
	if err := pgstore.InTx(ctx, pool, func(tx pgstore.Tx) error {
		_ = rt.With(tx)
		return errors.New("abort")
	}); err == nil {
		t.Fatal("aborted transaction reported success")
	}
	// The original still enqueues on its own, outside any transaction.
	waitState(t, rt, enqueue(t, rt, "w"), jobs.StateCompleted)
}
