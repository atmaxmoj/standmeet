// outbound_sender.go — the composition root's two faces of the mail side-effect port
// (internal/infra/sideeffect/mail): the port itself, for the subscribers that send mail as durable
// jobs, and the kernel-neutral `owner.OutboundSender` over it.
//
// The kernel-neutral face exists for two things only:
//   - Connected / ChannelName — "can a notice go out at all?", asked by approve, email change and
//     the gate. A question, not a side effect.
//   - Send — the recovery phrase, which stays synchronous by decision (#3): the owner waits on the
//     login page and must learn on the spot whether the phrase went out, so it cannot be a job
//     that finishes later. It is one attempt; a throttled or failed send is an error the owner
//     sees.

package port

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/mailthrottle"
	"github.com/atmaxmoj/standmeet/internal/infra/sideeffect/mail"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// errThrottled — the recipient's hourly cap is spent; the synchronous path cannot wait it out.
var errThrottled = errors.New("too many messages to this address this hour — try again later")

// MailSender — the mail side-effect port, over whichever supplier the registry resolves, with the
// per-recipient cap (email-bomb defense in depth). Only subscribers and this root hold it.
func MailSender(d *deps.Runtime) mail.Sender {
	return mail.New(d.BlockDispatch, mailthrottle.New(mailthrottle.RedisCounter{RDB: d.RDB}))
}

// SupplierInvoker —— one supplier verb by seam; what a sandboxed block's supplier.invoke reaches.
type SupplierInvoker interface {
	Invoke(
		ctx context.Context, ownerID, seam, verb string, args json.RawMessage,
	) (json.RawMessage, error)
}

// ThrottledSupplier —— supplier.invoke for sandboxed blocks, with a block's mail send under the
// same per-recipient cap as the host's own mail (email-recipient-throttle.md: one gate, no path
// around it). send_email names any recipient the visitor asks for, so without this a code holder
// could loop it at one victim.
func ThrottledSupplier(d *deps.Runtime, inv SupplierInvoker) ThrottledSupplierInvoker {
	return ThrottledSupplierInvoker{
		inv: inv, throttle: mailthrottle.New(mailthrottle.RedisCounter{RDB: d.RDB}),
	}
}

// ThrottledSupplierInvoker —— see ThrottledSupplier.
type ThrottledSupplierInvoker struct {
	inv      SupplierInvoker
	throttle *mailthrottle.Throttle
}

// Invoke —— a mail send over its recipient's cap is refused as retryable; everything else passes.
func (t ThrottledSupplierInvoker) Invoke(
	ctx context.Context, ownerID, seam, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	if t.overCap(ctx, seam, verb, args) {
		return nil, &hostop.FaultError{Code: hostop.FaultUnavailable, Err: errThrottled}
	}
	out, err := t.inv.Invoke(ctx, ownerID, seam, verb, args)
	if err != nil {
		return nil, fmt.Errorf("supplier %s/%s: %w", seam, verb, err)
	}
	return out, nil
}

// overCap —— a mail send whose recipient has spent its window (counts this attempt).
func (t ThrottledSupplierInvoker) overCap(
	ctx context.Context, seam, verb string, args json.RawMessage,
) bool {
	if seam != "mail" || verb != "send" {
		return false
	}
	var m struct {
		To string `json:"to"`
	}
	return json.Unmarshal(args, &m) == nil && t.throttle.Wait(ctx, m.To) > 0
}

// OutboundSenderAdapter — the kernel-neutral owner.OutboundSender over the mail port.
type OutboundSenderAdapter struct {
	mail mail.Sender
}

// ChannelName — which kind of supplier the owner should go connect when sending fails. Only this
// layer knows which category outbound is bound to; the kernel relays the name.
func (a OutboundSenderAdapter) ChannelName() string { return a.mail.Channel() }

// Connected — whether the owner has a usable outbound channel configured.
func (a OutboundSenderAdapter) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := a.mail.Connected(ctx, ownerID)
	if err != nil {
		return false, outboundErr("connected", err)
	}
	return ok, nil
}

// Send — one synchronous attempt (recovery only). "Title" is a notice concept; the port calls it
// the subject — the translation happens here, where both vocabularies are known.
func (a OutboundSenderAdapter) Send(
	ctx context.Context, ownerID string, n owner.OutboundNotice,
) error {
	err := a.mail.Send(ctx, ownerID, mail.Message{To: n.To, Subject: n.Title, Body: n.Body})
	if _, snoozed := jobs.SnoozeOf(err); snoozed {
		return fmt.Errorf("outbound send: %w", errThrottled)
	}
	if err != nil {
		return outboundErr("send", err)
	}
	return nil
}

// outboundErr — translates the channel side's "not configured" into the **kernel's own**
// sentinel. What the kernel does errors.Is against must be its own error: borrowing a sentinel
// with "mail" in the name would be admitting it knows the other side is email.
func outboundErr(what string, err error) error {
	if errors.Is(err, adapters.ErrMailNotConfigured) {
		return fmt.Errorf("outbound %s: %w", what, owner.ErrOutboundNotConfigured)
	}
	return fmt.Errorf("outbound %s: %w", what, err)
}

// OutboundSender — the kernel-neutral port, backed by the mail side-effect port.
func OutboundSender(d *deps.Runtime) OutboundSenderAdapter {
	return OutboundSenderAdapter{mail: MailSender(d)}
}
