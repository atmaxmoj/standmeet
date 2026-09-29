// Package mail — the side-effect port that sends mail (docs/design/event-bus-outbox-webhooks.md,
// *Enforcement*). It lives under internal/infra/sideeffect so the architecture lint can say who
// may hold it: subscriber packages (which run as durable jobs) and the composition root. A use
// case cannot send mail; it records an event or enqueues a job, and a subscriber sends.
//
// Behind it sits the registry's generic Invoke, not a typed mail proxy: the category and verb
// names appear only here, and whatever supplier the owner connected answers. One Send is one
// attempt. Its failure is classified for the job layer, which is the only retry owner:
//   - the per-recipient cap is spent → jobs.Snooze until the window ends (the mail waits, it is
//     not dropped, and no attempt is used up);
//   - a failure no retry can fix (no supplier, a 5xx rejection, a revoked grant) → jobs.Discard;
//   - anything else is retryable.
package mail

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/mailthrottle"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
)

// The one category and its verbs this port binds to.
const (
	category    = "mail"
	opSend      = "send"
	opConnected = "connected"
)

// Invoker — the registry's port: runs one verb of one category, JSON both ways.
type Invoker interface {
	Invoke(
		ctx context.Context, ownerID, category, verb string, args json.RawMessage,
	) (json.RawMessage, error)
}

// Message — one mail.
type Message struct {
	To      string
	Subject string
	Body    string
	// MessageID — "<id@host>", derived from the event or job that sends it, so a retried send
	// carries the same id and most mailboxes fold the duplicate into one. Empty = the provider's.
	MessageID string
}

// Sender — the port. The zero value is unusable; build it with New.
type Sender struct {
	inv      Invoker
	throttle *mailthrottle.Throttle
}

// New — a Sender over the registry's Invoke. throttle caps sends per recipient (email-bomb
// defense in depth); nil = no cap.
func New(inv Invoker, throttle *mailthrottle.Throttle) Sender {
	return Sender{inv: inv, throttle: throttle}
}

// Channel — which kind of supplier the owner connects so mail can go out; error messages name it.
func (Sender) Channel() string { return category }

// Connected — whether the owner has a usable mail supplier. A read, never a side effect.
func (s Sender) Connected(ctx context.Context, ownerID string) (bool, error) {
	raw, err := s.inv.Invoke(ctx, ownerID, category, opConnected, json.RawMessage(`{}`))
	if err != nil {
		return false, fmt.Errorf("mail connected: %w", err)
	}
	var out struct {
		Connected bool `json:"connected"`
	}
	if uerr := json.Unmarshal(raw, &out); uerr != nil {
		return false, fmt.Errorf("mail connected: decode: %w", uerr)
	}
	return out.Connected, nil
}

// wire — one message as the mail category's send verb reads it.
type wire struct {
	To        string `json:"to"`
	Subject   string `json:"subject"`
	Body      string `json:"body"`
	MessageID string `json:"message_id,omitempty"`
}

// Send — one attempt, its failure classified (see the package comment).
func (s Sender) Send(ctx context.Context, ownerID string, m Message) error {
	if wait := s.throttle.Wait(ctx, m.To); wait > 0 {
		return jobs.Snooze(wait)
	}
	args, err := json.Marshal(wire(m))
	if err != nil {
		return jobs.Discard(fmt.Errorf("mail send: encode: %w", err))
	}
	if _, err = s.inv.Invoke(ctx, ownerID, category, opSend, args); err != nil {
		err = fmt.Errorf("mail send: %w", err)
		if !adapters.MailTransient(err) {
			return jobs.Discard(err)
		}
		return err
	}
	return nil
}
