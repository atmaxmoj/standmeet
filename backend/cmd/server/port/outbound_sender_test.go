package port

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/mailthrottle"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

const (
	wireBudget    = 2 // per-recipient cap for this test — small so the third send is the one denied
	wireSends     = 3 // three sends to the same address; the last is over budget
	wireDelivered = 2 // …so only two must actually reach the channel
)

// countingInvoker — a fake categoryInvoker that records how many "send" verbs actually reached the
// channel. This is what proves the throttle is WIRED: a dropped send never calls Invoke.
type countingInvoker struct{ sends int }

func (c *countingInvoker) Invoke(
	_ context.Context, _, _, verb string, _ json.RawMessage,
) (json.RawMessage, error) {
	if verb == opSend {
		c.sends++
	}
	return json.RawMessage(`{}`), nil
}

// memCounter — an in-memory mailthrottle.Counter (no live Redis) so the adapter's throttle runs.
type memCounter struct{ n map[string]int64 }

func (m *memCounter) Incr(_ context.Context, key string) (int64, error) {
	if m.n == nil {
		m.n = map[string]int64{}
	}
	m.n[key]++
	return m.n[key], nil
}
func (*memCounter) SetTTL(context.Context, string, time.Duration) error { return nil }

// TestSend_throttleDropsOverBudget — the wiring test the throttle unit tests can't give: past the
// per-recipient budget, Send must NOT reach the channel, and must NOT error the caller (a booking
// still succeeds; only the extra mail is skipped). Falsifiable: delete the `if
// !a.throttle.Allow` guard in Send and the third send reaches the invoker → sends == 3 != 2.
func TestSend_throttleDropsOverBudget(t *testing.T) {
	t.Parallel()
	inv := &countingInvoker{}
	a := OutboundSenderAdapter{
		inv:      inv,
		throttle: mailthrottle.NewWithBudget(&memCounter{}, wireBudget, time.Hour),
		log:      slog.New(slog.DiscardHandler),
	}
	ctx := context.Background()
	for i := range wireSends {
		if err := a.Send(ctx, "owner-1", owner.OutboundNotice{
			To: "victim@example.com", Title: "hi", Body: "b",
		}); err != nil {
			t.Fatalf("send %d must not error the caller (throttle skips, not fails): %v", i+1, err)
		}
	}
	if inv.sends != wireDelivered {
		t.Errorf("over-budget send must be dropped before the channel: reached %d, want %d",
			inv.sends, wireDelivered)
	}
}
