// Package supplier — the side-effect port for a supplier call that runs after its caller is gone
// (docs/design/event-bus-outbox-webhooks.md, inventory #22): a durable job of kind
// supplier.invoke. It replaced a detached goroutine that retried in memory and was lost on
// restart. Its first user is the booking block's compensating calendar delete (#7): a booking
// whose record failed after its calendar event was created must not leave that event behind.
//
// One run is one attempt. The job layer is the only retry owner; a failure is classified:
//   - no retry can fix it (nothing connected, grant revoked, request rejected) → jobs.Discard;
//   - anything else is retryable.
package supplier

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
)

// Kind —— the job kind.
const Kind = "supplier.invoke"

// Limits: 10 attempts on the default backoff (1 s doubling) span about 8 minutes.
const (
	attempts = 10
	timeout  = 30 * time.Second
)

// Invoker —— the registry's port: runs one verb of one seam, JSON both ways.
type Invoker interface {
	Invoke(
		ctx context.Context, ownerID, seam, verb string, args json.RawMessage,
	) (json.RawMessage, error)
}

// Args —— one call, exactly as the block asked for it.
type Args struct {
	OwnerID string          `json:"owner_id"`
	Seam    string          `json:"seam"`
	Verb    string          `json:"verb"`
	Args    json.RawMessage `json:"args"`
}

// Kinds —— the supplier.invoke job kind.
func Kinds(inv Invoker) []jobs.Kind {
	return []jobs.Kind{{
		Name: Kind, Queue: jobs.QueueNotify, MaxAttempts: attempts, Timeout: timeout,
		Handle: func(ctx context.Context, raw json.RawMessage) error {
			return run(ctx, inv, raw)
		},
	}}
}

// Enqueue —— the call as a durable job; nil once the job is committed.
func Enqueue(ctx context.Context, j jobs.Jobs, a *Args) error {
	if _, err := j.Enqueue(ctx, Kind, a, jobs.EnqueueOpts{}); err != nil {
		return fmt.Errorf("enqueue %s %s/%s: %w", Kind, a.Seam, a.Verb, err)
	}
	return nil
}

// run —— one attempt, its failure classified.
func run(ctx context.Context, inv Invoker, raw json.RawMessage) error {
	var a Args
	if err := json.Unmarshal(raw, &a); err != nil || a.Seam == "" || a.Verb == "" {
		return jobs.Discard(fmt.Errorf("%s: bad args %s", Kind, raw))
	}
	_, err := inv.Invoke(ctx, a.OwnerID, a.Seam, a.Verb, a.Args)
	return classify(err, &a)
}

// classify —— nil stays nil; a failure no retry can fix is a Discard; the rest retry.
func classify(err error, a *Args) error {
	if err == nil {
		return nil
	}
	err = fmt.Errorf("%s %s/%s: %w", Kind, a.Seam, a.Verb, err)
	if adapters.SupplierPermanent(err) {
		return jobs.Discard(err)
	}
	return err
}
