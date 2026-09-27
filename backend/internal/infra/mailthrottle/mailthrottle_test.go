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
	testLeft      = 17 * time.Minute
	overBy        = 1
	twoRecipients = 2
)

// fakeCounter — an in-memory Counter so the budget decision is tested without live Redis.
type fakeCounter struct {
	counts map[string]int64
	ttl    map[string]time.Duration
	err    error
	left   time.Duration // what TTL reports
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

func (f *fakeCounter) TTL(context.Context, string) (time.Duration, error) { return f.left, nil }

// TestWait_capsPerRecipient — sends up to budget pass; the next must wait out the window's
// remaining time; the window TTL is set.
func TestWait_capsPerRecipient(t *testing.T) {
	t.Parallel()
	f := newFake()
	f.left = testLeft
	th := mailthrottle.NewWithBudget(f, testBudget, testWindow)
	ctx := context.Background()
	for i := range testBudget {
		if w := th.Wait(ctx, "victim@example.com"); w != 0 {
			t.Fatalf("send %d within budget must go now, got wait %s", i+1, w)
		}
	}
	if w := th.Wait(ctx, "victim@example.com"); w != testLeft {
		t.Errorf("past the budget: wait until the window ends (%s), got %s", testLeft, w)
	}
	if len(f.ttl) != twoRecipients-overBy { // exactly one key got a TTL (set on the first send)
		t.Errorf("window TTL must be set once on the first send, got %d", len(f.ttl))
	}
}

// TestWait_unknownTTLWaitsTheWindow — the counter cannot say how long is left: wait a whole window.
func TestWait_unknownTTLWaitsTheWindow(t *testing.T) {
	t.Parallel()
	th := mailthrottle.NewWithBudget(newFake(), 1, testWindow)
	ctx := context.Background()
	th.Wait(ctx, "v@example.com")
	if w := th.Wait(ctx, "v@example.com"); w != testWindow {
		t.Errorf("no TTL → wait the whole window, got %s", w)
	}
}

// TestWait_perRecipientIndependent — one victim's budget does not affect another recipient.
func TestWait_perRecipientIndependent(t *testing.T) {
	t.Parallel()
	f := newFake()
	th := mailthrottle.NewWithBudget(f, testBudget, testWindow)
	ctx := context.Background()
	for range testBudget + 1 { // exhaust victim A past budget
		th.Wait(ctx, "a@example.com")
	}
	if th.Wait(ctx, "b@example.com") != 0 {
		t.Error("a different recipient must have its own budget")
	}
	if len(f.counts) != twoRecipients {
		t.Errorf("two distinct recipients → two keys, got %d", len(f.counts))
	}
}

// TestWait_keyIsHashedAndNormalized — the key never contains the raw address, and case/space
// variants of the same address share one bucket (PII discipline + correct bucketing).
func TestWait_keyIsHashedAndNormalized(t *testing.T) {
	t.Parallel()
	f := newFake()
	th := mailthrottle.NewWithBudget(f, testBudget, testWindow)
	ctx := context.Background()
	th.Wait(ctx, "Alice@Example.com")
	th.Wait(ctx, "  alice@example.com ")
	if len(f.counts) != twoRecipients-overBy { // normalized to the SAME key → one bucket
		t.Fatalf("case/space variants must share one bucket, got %d keys", len(f.counts))
	}
	for k := range f.counts {
		if strings.Contains(k, "alice") || strings.Contains(k, "@") {
			t.Errorf("key must be hashed, not carry the raw address: %q", k)
		}
	}
}

// TestWait_failOpenOnError — a Redis error must NOT hold back a real send (fail-open).
func TestWait_failOpenOnError(t *testing.T) {
	t.Parallel()
	f := newFake()
	f.err = errors.New("redis down")
	th := mailthrottle.NewWithBudget(f, testBudget, testWindow)
	if th.Wait(context.Background(), "x@example.com") != 0 {
		t.Error("a counter error must fail open (go now), never break a legitimate send")
	}
}

// TestWait_nilThrottleGoes — a disabled throttle (nil) lets everything go.
func TestWait_nilThrottleGoes(t *testing.T) {
	t.Parallel()
	var th *mailthrottle.Throttle
	if th.Wait(context.Background(), "x@example.com") != 0 {
		t.Error("a nil throttle must let the send go (disabled)")
	}
}
