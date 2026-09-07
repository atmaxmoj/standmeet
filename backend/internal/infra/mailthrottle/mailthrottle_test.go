package mailthrottle_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/mailthrottle"
)

const (
	testBudget    = 3
	testWindow    = time.Hour
	overBy        = 1
	twoRecipients = 2
)

// fakeCounter — an in-memory Counter so the budget decision is tested without live Redis.
type fakeCounter struct {
	counts map[string]int64
	ttl    map[string]time.Duration
	err    error
}

func newFake() *fakeCounter {
	return &fakeCounter{counts: map[string]int64{}, ttl: map[string]time.Duration{}}
}

func (f *fakeCounter) Incr(_ context.Context, key string) (int64, error) {
	if f.err != nil {
		return 0, f.err
	}
	f.counts[key]++
	return f.counts[key], nil
}

func (f *fakeCounter) SetTTL(_ context.Context, key string, ttl time.Duration) error {
	f.ttl[key] = ttl
	return nil
}

// TestAllow_capsPerRecipient — sends up to budget pass; the next is denied; the window TTL is set.
func TestAllow_capsPerRecipient(t *testing.T) {
	t.Parallel()
	f := newFake()
	th := mailthrottle.NewWithBudget(f, testBudget, testWindow)
	ctx := context.Background()
	for i := range testBudget {
		if !th.Allow(ctx, "victim@example.com") {
			t.Fatalf("send %d within budget must be allowed", i+1)
		}
	}
	if th.Allow(ctx, "victim@example.com") {
		t.Error("the send past the budget must be denied")
	}
	if len(f.ttl) != twoRecipients-overBy { // exactly one key got a TTL (set on the first send)
		t.Errorf("window TTL must be set once on the first send, got %d", len(f.ttl))
	}
}

// TestAllow_perRecipientIndependent — one victim's budget does not affect another recipient.
func TestAllow_perRecipientIndependent(t *testing.T) {
	t.Parallel()
	f := newFake()
	th := mailthrottle.NewWithBudget(f, testBudget, testWindow)
	ctx := context.Background()
	for range testBudget + 1 { // exhaust victim A past budget
		th.Allow(ctx, "a@example.com")
	}
	if !th.Allow(ctx, "b@example.com") {
		t.Error("a different recipient must have its own budget")
	}
	if len(f.counts) != twoRecipients {
		t.Errorf("two distinct recipients → two keys, got %d", len(f.counts))
	}
}

// TestAllow_keyIsHashedAndNormalized — the key never contains the raw address, and case/space
// variants of the same address share one bucket (PII discipline + correct bucketing).
func TestAllow_keyIsHashedAndNormalized(t *testing.T) {
	t.Parallel()
	f := newFake()
	th := mailthrottle.NewWithBudget(f, testBudget, testWindow)
	ctx := context.Background()
	th.Allow(ctx, "Alice@Example.com")
	th.Allow(ctx, "  alice@example.com ")
	if len(f.counts) != twoRecipients-overBy { // normalized to the SAME key → one bucket
		t.Fatalf("case/space variants must share one bucket, got %d keys", len(f.counts))
	}
	for k := range f.counts {
		if strings.Contains(k, "alice") || strings.Contains(k, "@") {
			t.Errorf("key must be hashed, not carry the raw address: %q", k)
		}
	}
}

// TestAllow_failOpenOnError — a Redis error must NOT block a real send (fail-open).
func TestAllow_failOpenOnError(t *testing.T) {
	t.Parallel()
	f := newFake()
	f.err = errors.New("redis down")
	th := mailthrottle.NewWithBudget(f, testBudget, testWindow)
	if !th.Allow(context.Background(), "x@example.com") {
		t.Error("a counter error must fail open (allow), never break a legitimate send")
	}
}

// TestAllow_nilThrottleAllows — a disabled throttle (nil) allows everything.
func TestAllow_nilThrottleAllows(t *testing.T) {
	t.Parallel()
	var th *mailthrottle.Throttle
	if !th.Allow(context.Background(), "x@example.com") {
		t.Error("a nil throttle must allow (disabled)")
	}
}
