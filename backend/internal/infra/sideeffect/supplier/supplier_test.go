package supplier_test

// The supplier.invoke job on a real job runtime (River on a scratch Postgres): a call that fails
// for now is retried by the job layer until it goes through; one no retry can fix is discarded at
// once. This is the booking block's compensating calendar delete (inventory #7): it used to be
// one best-effort attempt.

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
	"github.com/atmaxmoj/standmeet/internal/infra/sideeffect/supplier"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
)

// calendar —— fails the first `failures` calls with err, then succeeds; counts every call.
type calendar struct {
	err      error
	failures int32
	calls    atomic.Int32
}

func (c *calendar) Invoke(
	_ context.Context, _, seam, verb string, _ json.RawMessage,
) (json.RawMessage, error) {
	if seam+"."+verb != "calendar.delete_event" {
		return nil, errors.New("unexpected call " + seam + "." + verb)
	}
	if c.calls.Add(1) <= c.failures {
		return nil, c.err
	}
	return json.RawMessage(`{"ok":true}`), nil
}

func started(t *testing.T, cal *calendar) jobs.Runtime {
	t.Helper()
	ctx := context.Background()
	pool := scratchDB(t)
	if err := jobsriver.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	rt, err := jobsriver.New(pool, supplier.Kinds(cal), nil,
		jobsriver.Options{FetchPollInterval: 20 * time.Millisecond, StopGrace: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if err = rt.Start(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if serr := rt.Stop(context.Background()); serr != nil {
			t.Errorf("stop: %v", serr)
		}
	})
	return rt
}

// run —— one compensating calendar delete, enqueued on a started runtime.
func run(t *testing.T, cal *calendar) (jobs.Runtime, jobs.JobID) {
	t.Helper()
	ctx := context.Background()
	rt := started(t, cal)
	id, err := rt.Enqueue(ctx, supplier.Kind, &supplier.Args{
		OwnerID: "o", Seam: "calendar", Verb: "delete_event",
		Args: json.RawMessage(`{"event_id":"ev1"}`),
	}, jobs.EnqueueOpts{})
	if err != nil {
		t.Fatal(err)
	}
	return rt, id
}

func waitTerminal(t *testing.T, rt jobs.Runtime, id jobs.JobID) jobs.State {
	t.Helper()
	st, ok := rt.Wait(context.Background(), id, 20*time.Second)
	if !ok {
		t.Fatalf("job %d did not finish (state %s)", id, st)
	}
	return st
}

// TestSupplierInvoke_retriedUntilItGoesThrough — the calendar is unreachable for the first two
// attempts; the job layer tries again and the third attempt deletes the event.
func TestSupplierInvoke_retriedUntilItGoesThrough(t *testing.T) {
	t.Parallel()
	cal := &calendar{failures: 2, err: &hostop.FaultError{
		Code: hostop.FaultUnavailable, Err: errors.New("calendar 503"),
	}}
	rt, id := run(t, cal)
	if st := waitTerminal(t, rt, id); st != jobs.StateCompleted {
		t.Fatalf("want completed after the retries, got %s", st)
	}
	if n := cal.calls.Load(); n != 3 {
		t.Errorf("want 3 delete_event attempts, got %d", n)
	}
}

// TestSupplierInvoke_permanentIsDiscarded — the owner's calendar grant is revoked: retrying cannot
// help, so the job is discarded after its one attempt.
func TestSupplierInvoke_permanentIsDiscarded(t *testing.T) {
	t.Parallel()
	cal := &calendar{failures: 100, err: &hostop.FaultError{
		Code: hostop.FaultUnavailable, Err: adapters.ErrCalendarRevoked,
	}}
	rt, id := run(t, cal)
	if st := waitTerminal(t, rt, id); st != jobs.StateDiscarded {
		t.Fatalf("want discarded, got %s", st)
	}
	if n := cal.calls.Load(); n != 1 {
		t.Errorf("a permanent failure is tried once, got %d", n)
	}
}
