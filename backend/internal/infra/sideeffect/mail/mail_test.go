package mail_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/mailthrottle"
	"github.com/atmaxmoj/standmeet/internal/infra/sideeffect/mail"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
)

const (
	budget = 2
	mails  = 5
	window = time.Hour
)

// recorder — a fake registry: records every send that reached the channel, or fails with err.
type recorder struct {
	err  error
	sent []json.RawMessage
}

func (r *recorder) Invoke(
	_ context.Context, _, _, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	if verb != "send" {
		return json.RawMessage(`{"connected":true}`), nil
	}
	if r.err != nil {
		return nil, r.err
	}
	r.sent = append(r.sent, args)
	return json.RawMessage(`{"ok":true}`), nil
}

// clockCounter — a fixed-window counter on a fake clock: a key expires when the clock passes its
// window's end.
type clockCounter struct {
	now    time.Time
	counts map[string]int64
	ends   map[string]time.Time
}

func (c *clockCounter) Incr(_ context.Context, key string) (int64, error) {
	if end, ok := c.ends[key]; ok && !c.now.Before(end) {
		delete(c.counts, key)
		delete(c.ends, key)
	}
	c.counts[key]++
	return c.counts[key], nil
}

func (c *clockCounter) SetTTL(_ context.Context, key string, ttl time.Duration) error {
	c.ends[key] = c.now.Add(ttl)
	return nil
}

func (c *clockCounter) TTL(_ context.Context, key string) (time.Duration, error) {
	return c.ends[key].Sub(c.now), nil
}

// TestSend_overCapSnoozesUntilTheNextWindow — past the per-recipient cap a mail is not dropped:
// its job snoozes until the window ends, and then it goes out. Every mail arrives, the same
// count as were sent, and never more than the cap in one window. Falsifiable: turn the snooze
// back into a silent drop and only `budget` of `mails` ever reach the channel.
func TestSend_overCapSnoozesUntilTheNextWindow(t *testing.T) {
	t.Parallel()
	inv := &recorder{}
	clock := &clockCounter{
		now: time.Unix(0, 0), counts: map[string]int64{}, ends: map[string]time.Time{},
	}
	s := mail.New(inv, mailthrottle.NewWithBudget(clock, budget, window))
	ctx := context.Background()
	waiting := mails
	for windows := 0; waiting > 0; windows++ {
		if windows > mails {
			t.Fatalf("mails never drained: %d still waiting", waiting)
		}
		next, snooze := sendAll(ctx, t, s, waiting)
		if got := waiting - next; got > budget {
			t.Fatalf("window %d let %d mails out, cap is %d", windows, got, budget)
		}
		waiting = next
		clock.now = clock.now.Add(snooze) // the job layer runs the snoozed jobs again
	}
	if len(inv.sent) != mails {
		t.Errorf("every mail must go out in a later window: sent %d, want %d",
			len(inv.sent), mails)
	}
}

// sendAll — one attempt for each of n waiting mails; how many snoozed, and for how long.
func sendAll(ctx context.Context, t *testing.T, s mail.Sender, n int) (int, time.Duration) {
	t.Helper()
	snoozed, longest := 0, time.Duration(0)
	m := mail.Message{To: "victim@example.com", Subject: "s", Body: "b"}
	for range n {
		err := s.Send(ctx, "owner-1", m)
		if err == nil {
			continue
		}
		d, ok := jobs.SnoozeOf(err)
		if !ok || d <= 0 {
			t.Fatalf("over the cap must snooze, got %v", err)
		}
		snoozed++
		longest = max(longest, d)
	}
	return snoozed, longest
}

// TestSend_classifiesFailures — a rejected message or a missing supplier is discarded (no retry
// helps); a supplier that is down for now is retryable.
func TestSend_classifiesFailures(t *testing.T) {
	t.Parallel()
	fault := func(code string, err error) error { return &hostop.FaultError{Code: code, Err: err} }
	rejected := fault(hostop.FaultRejected, errors.New("550 no such user"))
	cases := []struct {
		err     error
		name    string
		discard bool
	}{
		{
			name: "5xx rejection inside the dispatcher's fault", discard: true,
			err: fault(hostop.FaultUnavailable, fmt.Errorf("mail send: %w", rejected)),
		},
		{
			name: "no supplier", discard: true,
			err: fmt.Errorf("x: %w", adapters.ErrMailNotConfigured),
		},
		{
			name: "unreachable", discard: false,
			err: fault(hostop.FaultUnavailable, errors.New("connection refused")),
		},
	}
	for _, c := range cases {
		s := mail.New(&recorder{err: c.err}, nil)
		err := s.Send(context.Background(), "o", mail.Message{To: "a@example.com"})
		if err == nil || jobs.IsDiscard(err) != c.discard {
			t.Errorf("%s: discard=%v, got %v", c.name, c.discard, err)
		}
	}
}

// TestSend_carriesMessageID — the Message-ID reaches the channel.
func TestSend_carriesMessageID(t *testing.T) {
	t.Parallel()
	inv := &recorder{}
	s := mail.New(inv, nil)
	if err := s.Send(context.Background(), "o",
		mail.Message{To: "a@example.com", MessageID: "<ev-1@standmeet>"}); err != nil {
		t.Fatal(err)
	}
	var w struct {
		MessageID string `json:"message_id"`
	}
	if len(inv.sent) != 1 || json.Unmarshal(inv.sent[0], &w) != nil {
		t.Fatalf("one readable send expected, got %s", inv.sent)
	}
	if w.MessageID != "<ev-1@standmeet>" {
		t.Errorf("message_id must reach the channel, got %q", w.MessageID)
	}
}
