// ports.go — the interfaces the upper layers program against.

package jobs

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Jobs — enqueue work. With(tx) binds the insert to the caller's transaction: the job exists if
// and only if the transaction commits.
type Jobs interface {
	With(tx pgstore.Tx) Jobs
	//nolint:forbidigo // args is the JSON payload; encoding/json.Marshal takes interface{}
	Enqueue(ctx context.Context, kind string, args any, opts EnqueueOpts) (JobID, error)
}

// Inspector — reads and acts on job rows (the Tasks panel, MCP tasks.*).
type Inspector interface {
	Overview(ctx context.Context, kind string) (Overview, error) // kind "" = every kind
	List(ctx context.Context, f Filter) ([]Job, error)
	Get(ctx context.Context, id JobID) (Job, error)
	Retry(ctx context.Context, id JobID) error
	Cancel(ctx context.Context, id JobID) error
	Periodic(ctx context.Context) ([]PeriodicState, error)
	RunPeriodic(ctx context.Context, name string) error
}

// Runtime — the whole implementation: enqueue, inspect, wait, and the worker lifecycle.
type Runtime interface {
	Jobs
	Inspector
	// Wait blocks until the job is terminal or max elapses, whichever is first. ok=false means
	// it did not finish in time (or too many requests are already waiting — the caller gets its
	// receipt at once instead of queueing).
	Wait(ctx context.Context, id JobID, maxWait time.Duration) (state State, ok bool)
	Start(ctx context.Context) error
	// Stop stops claiming, waits up to the given grace for running jobs, then cancels them.
	// Unfinished jobs stay running and are rescued after restart (at least once).
	Stop(ctx context.Context) error
}

// State — a job's state as the Tasks panel shows it.
type State string

// The states.
const (
	StatePending   State = "pending"   // waiting for a worker (includes scheduled for later)
	StateRunning   State = "running"   //
	StateRetryable State = "retryable" // failed, another attempt is scheduled
	StateCompleted State = "completed" //
	StateDiscarded State = "discarded" // permanent failure or attempts exhausted
	StateCancelled State = "cancelled" // cancelled by the owner
)

// Terminal — whether s is final.
func (s State) Terminal() bool {
	return s == StateCompleted || s == StateDiscarded || s == StateCancelled
}
