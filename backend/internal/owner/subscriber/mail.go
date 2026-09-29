// mail.go —— the owner domain's mail, sent as durable jobs
// (docs/design/event-bus-outbox-webhooks.md, *Phase 4*). Each handler reads what it needs with
// short reads, sends through the mail side-effect port with no transaction held, and only then
// writes the business state that follows the send:
//
//   - owner.notify (a subscription on access_request.created): mails the owner that someone
//     asked for access. The email-bomb cap (5 per owner per hour) is kept as a drop — a flood
//     must not mail the owner once per request; every request stays visible in admin.
//   - owner.notify on booking.created: mails the owner the booking notice the booking block
//     left with the event (when the visitor's role asked for one), then deletes it.
//   - access_request.approval_mail {owner_id, request_id, code_id}: mails the approved requester
//     their code, then marks the request replied.
//   - owner.email_confirmation {owner_id, email}: mints the link's token and mails it to the new
//     address, while that exact change is still pending.
//
// Retry is the job layer's: a handler only classifies (the mail port does it for sends; a
// missing row is a Discard). One policy for all three (*Retry*, owner.notify): 8 attempts over
// about 6 h.

package subscriber

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/sideeffect/mail"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Mail job limits.
const (
	mailAttempts = 8
	mailTimeout  = 30 * time.Second
	// notifyBurst / notifyWindow —— the owner-notification cap: at most this many per owner per
	// window. Small on purpose: "someone asked for access" is not urgent.
	notifyBurst   = 5
	notifyWindow  = time.Hour
	backoffFirst  = 20 * time.Second
	backoffGrowth = 3
)

// MailDeps —— what the mail handlers read and the port they send through.
type MailDeps struct {
	Reqs   *access.RequestRepo
	Codes  *access.CodeRepo
	Owners *repo.Repo
	Log    *slog.Logger
	Mail   mail.Sender
	Events events.Recorder // "replied" is a status change: access_request.status_changed
}

// MailBackoff —— 20 s, then ×3 per attempt: 20 s · 1 min · 3 min · 9 min · 27 min · 81 min ·
// 243 min, about 6 h across 8 attempts. The first retry is quick: most send failures are brief.
func MailBackoff(attempt int) time.Duration {
	d := backoffFirst
	for i := 1; i < attempt; i++ {
		d *= backoffGrowth
	}
	return d
}

// MailSubscriptions —— owner.notify on access_request.created and booking.created.
func MailSubscriptions(d *MailDeps) []events.Subscription {
	return []events.Subscription{{
		Name:  entity.OwnerNotify,
		Types: []string{access.AccessRequestCreated, usecase.BookingCreated},
		Queue: jobs.QueueNotify, MaxAttempts: mailAttempts, Timeout: mailTimeout,
		Backoff: MailBackoff,
		Handle: func(ctx context.Context, ev events.Event) error {
			if ev.Type == usecase.BookingCreated {
				return notifyBooking(ctx, d, &ev)
			}
			return notifyOwner(ctx, d, &ev)
		},
	}}
}

// notifyBooking —— one attempt of owner.notify on booking.created: mails the notice waiting for
// this booking, then deletes it. Idempotent: a notice already sent is gone, so a second run sends
// nothing. No notice = the role asked for none. No mail supplier or no owner address = nothing
// can ever be sent, so the notice is dropped (and the drop logged).
//
//nolint:wrapcheck // the repo names its steps
func notifyBooking(ctx context.Context, d *MailDeps, ev *events.Event) error {
	var data struct {
		BookingID string `json:"booking_id"`
	}
	if err := json.Unmarshal(ev.Data, &data); err != nil || data.BookingID == "" {
		//nolint:wrapcheck // Discard is the failure class; it wraps the cause
		return jobs.Discard(fmt.Errorf("owner.notify: unreadable event data %s", ev.Data))
	}
	n, err := d.Owners.BookingNotice(ctx, ev.OwnerID, data.BookingID)
	if err != nil || n == nil {
		return err
	}
	return sendThenForget(ctx, d, ev, n)
}

// sendThenForget —— send, then delete the notice: a crash in between sends it twice, never zero
// times.
//
//nolint:wrapcheck // the repo names its steps
func sendThenForget(
	ctx context.Context, d *MailDeps, ev *events.Event, n *repo.BookingNotice,
) error {
	if err := sendBookingNotice(ctx, d, ev, n); err != nil {
		return err
	}
	return d.Owners.DeleteBookingNotice(ctx, ev.OwnerID, n.BookingID)
}

// sendBookingNotice —— one send of n. nil also when it can never be sent (no owner address, no
// mail supplier): the drop is logged and the notice goes.
//
//nolint:wrapcheck // the repo and the port name their steps
func sendBookingNotice(
	ctx context.Context, d *MailDeps, ev *events.Event, n *repo.BookingNotice,
) error {
	o, err := d.Owners.GetByID(ctx, ev.OwnerID)
	if err != nil {
		return err
	}
	if o.Email == "" || noSupplier(ctx, d, ev.OwnerID) {
		d.Log.Info("booking owner notification dropped: nowhere to send it", "owner_id", ev.OwnerID)
		return nil
	}
	notice := usecase.NewBookingNotice(n, o.Email, o.ProfileTimezone)
	return d.Mail.Send(ctx, ev.OwnerID, message(&notice, messageID(ev.ID)))
}

type mailRun func(context.Context, *MailDeps, json.RawMessage) error

// MailKinds —— the approval mail and the email-change confirmation.
func MailKinds(d *MailDeps) []jobs.Kind {
	kind := func(name string, run mailRun) jobs.Kind {
		return jobs.Kind{
			Name: name, Queue: jobs.QueueNotify, MaxAttempts: mailAttempts,
			Timeout: mailTimeout, Backoff: MailBackoff,
			Handle: func(ctx context.Context, raw json.RawMessage) error {
				return run(ctx, d, raw)
			},
		}
	}
	return []jobs.Kind{
		kind(entity.ApprovalNoticeKind, sendApproval),
		kind(entity.EmailConfirmKind, sendEmailConfirm),
	}
}

// notifyOwner —— one attempt of owner.notify. Idempotent: a request already notified sends
// nothing, and a retry keeps the slot its first attempt took (so retries never eat the cap).
func notifyOwner(ctx context.Context, d *MailDeps, ev *events.Event) error {
	var data struct {
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(ev.Data, &data); err != nil || data.RequestID == "" {
		//nolint:wrapcheck // Discard is the failure class; it wraps the cause
		return jobs.Discard(fmt.Errorf("owner.notify: unreadable event data %s", ev.Data))
	}
	if noSupplier(ctx, d, ev.OwnerID) {
		return nil
	}
	slot, err := d.Reqs.ClaimNotifySlot(ctx, ev.OwnerID, data.RequestID, notifyBurst, notifyWindow)
	if err != nil {
		return discardMissing(err)
	}
	return notifyBySlot(ctx, d, ev, data.RequestID, slot)
}

// noSupplier —— the owner has no mail supplier at all: there is nothing to send, so the job ends
// (and says so in the log) instead of failing toward an alert. An unreadable answer is not "no".
func noSupplier(ctx context.Context, d *MailDeps, ownerID string) bool {
	ok, err := d.Mail.Connected(ctx, ownerID)
	if err != nil || ok {
		return false
	}
	d.Log.Info("owner notification skipped: no mail supplier", "owner_id", ownerID)
	return true
}

// notifyBySlot —— send when a slot is held; nothing when already sent; a logged drop over the cap.
func notifyBySlot(
	ctx context.Context, d *MailDeps, ev *events.Event, requestID string, slot access.NotifySlot,
) error {
	switch slot {
	case access.NotifySend:
		return sendNotify(ctx, d, ev, requestID)
	case access.NotifyDropped:
		d.Log.Warn("access-request owner notification dropped (email-bomb cap)",
			"owner_id", ev.OwnerID, "request_id", requestID)
	case access.NotifySent: // this request's owner notice already went out: nothing to do
	default:
		d.Log.Warn("access-request owner notification: unknown slot, nothing sent",
			"owner_id", ev.OwnerID, "request_id", requestID, "slot", slot)
	}
	return nil
}

//nolint:wrapcheck // the repos and the port name their steps
func sendNotify(ctx context.Context, d *MailDeps, ev *events.Event, requestID string) error {
	req, err := d.Reqs.GetByID(ctx, ev.OwnerID, requestID)
	if err != nil {
		return discardMissing(err)
	}
	o, err := d.Owners.GetByID(ctx, ev.OwnerID)
	if err != nil {
		return err
	}
	n := usecase.NewRequestNotice(&req, o.Email, o.PublicURL)
	if serr := d.Mail.Send(ctx, ev.OwnerID, message(&n, messageID(ev.ID))); serr != nil {
		return serr
	}
	return d.Reqs.MarkNotified(ctx, ev.OwnerID, requestID)
}

// sendApproval —— one attempt of the approval mail: send, then mark the request replied.
//
//nolint:wrapcheck // the repos and the port name their steps
func sendApproval(ctx context.Context, d *MailDeps, raw json.RawMessage) error {
	a, err := approvalArgs(raw)
	if err != nil {
		return err
	}
	n, err := approvalNotice(ctx, d, &a)
	if err != nil {
		return err
	}
	msg := message(&n, messageID("approval-"+a.CodeID))
	if serr := d.Mail.Send(ctx, a.OwnerID, msg); serr != nil {
		return serr
	}
	rd := access.RequestsDeps{Repo: d.Reqs, Pool: d.Reqs.Pool(), Events: d.Events}
	_, err = access.UpdateAccessRequestStatus(ctx, rd, a.OwnerID, a.RequestID, "replied")
	return err
}

func approvalArgs(raw json.RawMessage) (entity.ApprovalNoticeArgs, error) {
	var a entity.ApprovalNoticeArgs
	if err := json.Unmarshal(raw, &a); err != nil || a.RequestID == "" || a.CodeID == "" {
		return a, badArgs(entity.ApprovalNoticeKind, raw)
	}
	return a, nil
}

func confirmArgs(raw json.RawMessage) (entity.EmailConfirmArgs, error) {
	var a entity.EmailConfirmArgs
	if err := json.Unmarshal(raw, &a); err != nil || a.OwnerID == "" || a.Email == "" {
		return a, badArgs(entity.EmailConfirmKind, raw)
	}
	return a, nil
}

// approvalNotice —— the request, its code and the owner's page, rendered.
//
//nolint:wrapcheck // the repos name their steps
func approvalNotice(
	ctx context.Context, d *MailDeps, a *entity.ApprovalNoticeArgs,
) (usecase.OutboundNotice, error) {
	req, err := d.Reqs.GetByID(ctx, a.OwnerID, a.RequestID)
	if err != nil {
		return usecase.OutboundNotice{}, discardMissing(err)
	}
	code, err := d.Codes.GetByID(ctx, a.CodeID)
	if err != nil {
		return usecase.OutboundNotice{}, discardMissing(err)
	}
	o, err := d.Owners.GetByID(ctx, a.OwnerID)
	if err != nil {
		return usecase.OutboundNotice{}, err
	}
	link := usecase.CodeLink(o.PublicURL, code.Code)
	return usecase.ApprovalNotice(&req, code.Code, link), nil
}

// sendEmailConfirm —— one attempt of the confirmation mail. The token is minted here and its
// hash stored only while this exact change is still pending; a cancelled or replaced change
// sends nothing. Each attempt mints a new token, so only the latest mail's link works.
//
//nolint:wrapcheck // the repo and the port name their steps
func sendEmailConfirm(ctx context.Context, d *MailDeps, raw json.RawMessage) error {
	a, err := confirmArgs(raw)
	if err != nil {
		return err
	}
	token, err := mintConfirmToken(ctx, d, &a)
	if err != nil || token == "" {
		return err
	}
	o, err := d.Owners.GetByID(ctx, a.OwnerID)
	if err != nil {
		return err
	}
	n := usecase.EmailConfirmNotice(a.Email, o.PublicURL, token)
	return d.Mail.Send(ctx, a.OwnerID, message(&n, ""))
}

// mintConfirmToken —— a fresh link token whose hash the pending row now accepts; "" when the
// change is no longer pending (cancelled, replaced or expired).
//
//nolint:wrapcheck // the usecase and the repo name their steps
func mintConfirmToken(
	ctx context.Context, d *MailDeps, a *entity.EmailConfirmArgs,
) (string, error) {
	token, err := usecase.NewEmailToken()
	if err != nil {
		return "", err
	}
	hash := usecase.HashEmailToken(token)
	pending, err := d.Owners.RotatePendingEmailToken(ctx, a.OwnerID, a.Email, hash)
	if err != nil || !pending {
		return "", err
	}
	return token, nil
}

// badArgs —— args no attempt can read.
func badArgs(kind string, raw json.RawMessage) error {
	return jobs.Discard(fmt.Errorf("%s: bad args %s", kind, raw)) //nolint:wrapcheck // the class
}

// discardMissing —— a row the job needs is gone (deleted request, revoked code): nothing to send.
func discardMissing(err error) error {
	if errors.Is(err, access.ErrAccessRequestNotFound) || errors.Is(err, access.ErrCodeInvalid) {
		return jobs.Discard(err) //nolint:wrapcheck // the failure class
	}
	return err
}

// messageID —— the Message-ID a retried send repeats.
func messageID(id string) string { return "<" + id + "@standmeet>" }

func message(n *usecase.OutboundNotice, id string) mail.Message {
	return mail.Message{To: n.To, Subject: n.Title, Body: n.Body, MessageID: id}
}
