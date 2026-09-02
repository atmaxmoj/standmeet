// query_queue.go —— two-tier rate limiting for visitor chat inference
// requests. Design ported from legacy
// standmeet-server/gateway/src/session/query-queue.ts.
//
//  1. Global concurrent cap: at most maxConcurrent inference queries run
//     at once (guards against blowing the owner's anthropic/openai quota).
//  2. Per-session in-flight cap: a single visitor session may have at
//     most 1 query in flight (stops a visitor firing multiple SSE
//     streams, each running its own agent loop and burning the owner's
//     bill).
//
// Queueing rule: can't get a slot -> wait until timeout fires
// ErrQueueTimeout. The caller (visitor_chat) degrades gracefully to
// HTTP 503 / "server busy" instead of hanging an SSE error event.

package session

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ErrQueueTimeout —— timed out waiting for a slot; caller maps this to
// HTTP 503 / "server busy".
var ErrQueueTimeout = errors.New("query queue timeout")

// ErrSessionBusy —— this session already has an in-flight query; caller
// maps this to 429. Distinct from ErrQueueTimeout: the former means
// "this session hit its own wall", the latter means "the global cap is
// full".
var ErrSessionBusy = errors.New("session already has an in-flight query")

// QueryQueue —— two-tier cap: global maxConcurrent + per-session uniqueness.
type QueryQueue struct {
	cond          *sync.Cond          // wakes waiters
	active        map[string]struct{} // sessionID -> in-flight marker
	maxConcurrent int
	mu            sync.Mutex
}

// NewQueryQueue —— maxConcurrent is the global cap; <=0 means unlimited
// (dev default).
func NewQueryQueue(maxConcurrent int) *QueryQueue {
	q := &QueryQueue{maxConcurrent: maxConcurrent, active: map[string]struct{}{}}
	q.cond = sync.NewCond(&q.mu)
	return q
}

// Acquire —— enqueues sessionID and waits for a slot. Returns
// ErrQueueTimeout once timeout elapses. A re-entrant call with the same
// sessionID returns ErrSessionBusy immediately (no waiting).
func (q *QueryQueue) Acquire(ctx context.Context, sessionID string, timeout time.Duration) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if _, busy := q.active[sessionID]; busy {
		return ErrSessionBusy
	}
	if err := q.waitCapacity(ctx, timeout); err != nil {
		return err
	}
	q.active[sessionID] = struct{}{}
	return nil
}

// waitForSlot —— cond.Wait paired with a deadline; a separate goroutine
// Broadcasts on deadline or ctx cancel so every waiter re-evaluates its
// condition and exits with a failure.
func waitForSlot(ctx context.Context, cond *sync.Cond, deadline time.Time) error {
	if time.Until(deadline) <= 0 {
		return ErrQueueTimeout
	}
	done := make(chan struct{})
	defer close(done)
	go waitWakeup(ctx, cond, deadline, done)
	cond.Wait()
	return checkWaitResult(ctx, deadline)
}

func waitWakeup(ctx context.Context, cond *sync.Cond, deadline time.Time, done <-chan struct{}) {
	select {
	case <-time.After(time.Until(deadline)):
	case <-ctx.Done():
	case <-done:
		return
	}
	cond.L.Lock()
	cond.Broadcast()
	cond.L.Unlock()
}

func checkWaitResult(ctx context.Context, deadline time.Time) error {
	if cerr := ctx.Err(); cerr != nil {
		return fmt.Errorf("query queue ctx: %w", cerr)
	}
	if time.Now().After(deadline) {
		return ErrQueueTimeout
	}
	return nil
}

// Release —— query finished, frees the slot and wakes one waiter.
func (q *QueryQueue) Release(sessionID string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	delete(q.active, sessionID)
	q.cond.Signal()
}

// Active —— current in-flight query count; used by admin / metrics.
func (q *QueryQueue) Active() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.active)
}

// waitCapacity —— passes through immediately when maxConcurrent <= 0;
// otherwise cond.Wait until a slot opens or timeout. Caller must hold q.mu.
func (q *QueryQueue) waitCapacity(ctx context.Context, timeout time.Duration) error {
	if q.maxConcurrent <= 0 {
		return nil
	}
	deadline := time.Now().Add(timeout)
	for len(q.active) >= q.maxConcurrent {
		if err := waitForSlot(ctx, q.cond, deadline); err != nil {
			return err
		}
	}
	return nil
}
