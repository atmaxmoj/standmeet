// outbound_sender.go — behind the kernel-neutral `owner.OutboundSender` sits the
// **registry's generic Invoke**.
//
// The kernel needs to send mail itself (OTP / recovery / booking confirmation), a
// scenario §1.6 acknowledges. But how it sends must be **ask the registry by name for
// a connector, then `Invoke(op, argsJSON)` on it** — not hold a typed `contract.MailProxy`.
// The difference isn't elegance:
//
//   - A typed proxy is **compile-time** coupling. As soon as the kernel can write
//     `proxy.Send(...)`, it knows "sending mail" is a thing, and knows a message is
//     made of To/Subject/Body/HTML. Delete the name and the shape is still there.
//   - `Invoke("send", json)` is **run-time** access by string. All the kernel can write
//     is one string and one opaque JSON blob; it doesn't know whether the other side is
//     SMTP, some SaaS, or not even connected.
//
// The category name and verb name each appear exactly once here — this is the
// **composition root**, and the composition root's job is to wire in the concrete
// thing. They don't appear anywhere in `internal/`; that's the line to guard.

package port

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// The composition root binds "kernel needs to send mail" to one verb of one category
// here. The kernel side sees not a single string of it.
const (
	outboundCategory = "mail"
	opSend           = "send"
	opConnected      = "connected"
)

// categoryInvoker — the registry's port: runs once by category + verb, both sides
// opaque JSON.
type categoryInvoker interface {
	Invoke(
		ctx context.Context, ownerID, category, verb string, args json.RawMessage,
	) (json.RawMessage, error)
}

// OutboundSenderAdapter — wraps the registry's generic Invoke into the kernel-neutral
// OutboundSender.
type OutboundSenderAdapter struct{ inv categoryInvoker }

// ChannelName — which kind of connector the owner should go connect when sending
// fails. **Only this layer knows which category this instance bound outbound to**;
// the kernel relays this name rather than inventing its own (the phrase "outbound
// channel" doesn't exist in the UI — the owner couldn't find anything with it).
func (OutboundSenderAdapter) ChannelName() string { return outboundCategory }

// Connected — whether the owner has a usable outbound channel configured.
func (a OutboundSenderAdapter) Connected(ctx context.Context, ownerID string) (bool, error) {
	raw, err := a.inv.Invoke(ctx, ownerID, outboundCategory, opConnected, json.RawMessage(`{}`))
	if err != nil {
		return false, outboundErr("connected", err)
	}
	// The reply shape is defined by **this side's verb** (`{"connected":bool}`); the
	// composition root decodes it accordingly.
	var out struct {
		Connected bool `json:"connected"`
	}
	if uerr := json.Unmarshal(raw, &out); uerr != nil {
		return false, fmt.Errorf("outbound connected: decode: %w", uerr)
	}
	return out.Connected, nil
}

// Send — sends one message. The kernel doesn't know whether the other side is SMTP
// or some SaaS, and doesn't know it's called mail.
func (a OutboundSenderAdapter) Send(
	ctx context.Context, ownerID string, n owner.OutboundNotice,
) error {
	// The on-the-wire field names are fixed here. The kernel's OutboundMessage is the
	// **kernel's own** vocabulary, with no json tag; the composition root is responsible
	// for translating it into the shape the other side understands — that's exactly
	// what "translation belongs to the composition root" means.
	args, merr := json.Marshal(outboundWire{To: n.To, Subject: n.Title, Body: n.Body})
	if merr != nil {
		return fmt.Errorf("outbound send: encode: %w", merr)
	}
	if _, err := a.inv.Invoke(ctx, ownerID, outboundCategory, opSend, args); err != nil {
		return outboundErr("send", err)
	}
	return nil
}

// outboundWire — what one notice looks like **on the wire**. It's a contract between
// the composition root and the channel, not the kernel's type: the kernel only has
// `owner.OutboundNotice{To,Title,Body}`, that's its own vocabulary. **The Title →
// subject translation happens right here** — "title" is a notice concept, "subject
// line" is an email concept, and the kernel can only say the former.
type outboundWire struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

// outboundErr — translates the channel side's "not configured" into the **kernel's
// own** sentinel.
//
// What the kernel does errors.Is against must be its own error: borrowing a sentinel
// with "mail" in the name would be admitting it knows the other side is email. The
// translation happens here because this is the composition root — it's supposed to
// know both sides at once.
func outboundErr(what string, err error) error {
	if errors.Is(err, consumer.ErrMailNotConfigured) {
		return fmt.Errorf("outbound %s: %w", what, owner.ErrOutboundNotConfigured)
	}
	return fmt.Errorf("outbound %s: %w", what, err)
}

// OutboundSender — the kernel-neutral send port, backed by whichever connector the
// registry resolves by name.
func OutboundSender(d *deps.Runtime) OutboundSenderAdapter {
	return OutboundSenderAdapter{inv: d.ConnectorSlots}
}
