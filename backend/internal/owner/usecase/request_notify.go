// request_notify.go — tell the owner a visitor submitted a gate access request.
//
// Same shape as access_approval.go: the notice's content is the product's (StandMeet telling
// the owner someone wants in), delivery goes only through OutboundSender — this package never
// knows the channel is email, nor that sends are throttled. The difference from approval: this
// is **best-effort**. The request is already stored before we get here; a missing/broken/dropped
// channel must never fail the visitor's submission, so this returns nothing and only logs.
//
// The email-bomb cap is NOT here: it's a property of the send channel, so it lives behind the
// OutboundSender the composition root wires in (a dedicated per-owner burst throttle — see
// cmd/server/port). This package just calls Send; a throttled send comes back as a no-op.

package usecase

import (
	"context"
	"log/slog"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// NotifyNewRequestDeps — deps for the submit-notification hook. Reuses the existing outbound
// channel (OutboundSender); nothing bespoke. Proxy may be a throttled variant (email-bomb
// defense), but that is opaque here.
type NotifyNewRequestDeps struct {
	Owners *repo.Repo
	Proxy  OutboundSender
	Log    *slog.Logger
}

// NotifyOwnerOfNewRequest — best-effort: email the owner that a new access request arrived.
// Never returns an error (the request is already stored); an unconfigured/failed/throttled send
// is logged and swallowed.
func NotifyOwnerOfNewRequest(
	ctx context.Context, deps NotifyNewRequestDeps, ownerID string, req *access.Request,
) {
	o, err := deps.Owners.GetByID(ctx, ownerID)
	if err != nil {
		deps.Log.Warn("access-request notify: get owner", "owner_id", ownerID, "err", err)
		return
	}
	notice := buildNewRequestNotice(req, o.Email, o.PublicURL)
	if serr := deps.Proxy.Send(ctx, ownerID, notice); serr != nil {
		deps.Log.Warn("access-request owner notification not delivered (best-effort)",
			"owner_id", ownerID, "err", serr)
	}
}

// buildNewRequestNotice — the notice content. The owner sees who asked and what they said so they
// can decide whether to approve (which then issues + delivers a code, see access_approval.go).
func buildNewRequestNotice(req *access.Request, ownerEmail, publicURL string) OutboundNotice {
	from := req.Email
	if req.Name != "" {
		from = req.Name + " <" + req.Email + ">"
	}
	body := "Someone requested access on your StandMeet page.\n\n" +
		"From:    " + from + "\n"
	if req.Org != "" {
		body += "Org:     " + req.Org + "\n"
	}
	body += "\nMessage:\n" + req.Message + "\n"
	if publicURL != "" {
		body += "\nReview and approve in your admin, or ask your AI:\n" +
			"    \"list my access requests\"\n"
	}
	body += "\nSent via StandMeet."
	return OutboundNotice{
		To:    ownerEmail,
		Title: "New access request from " + req.Email,
		Body:  body,
	}
}
