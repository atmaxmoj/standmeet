// request_notify.go — tell the owner a visitor submitted a gate access request.
//
// Same shape as access_approval.go: the notice's content is the product's (StandMeet telling
// the owner someone wants in), delivery goes only through OutboundSender — this package never
// knows the channel is email. The difference from approval: this is **best-effort**. The request
// is already stored before we get here; a missing/broken/throttled channel must never fail the
// visitor's submission, so NotifyOwnerOfNewRequest returns nothing and only logs.

package usecase

import (
	"context"
	"log/slog"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/mailthrottle"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// NotifyNewRequestDeps — deps for the submit-notification hook. Reuses the existing outbound
// channel (OutboundSender) and the existing per-recipient throttle type; nothing bespoke.
//
// Throttle is a DEDICATED instance keyed on the owner id (a synthetic recipient, see notifyKey),
// NOT the owner's real address. The owner is the sole recipient of every submit notification, so
// keying the shared per-address bucket would let an access-request flood eat the same budget the
// owner needs for OTP / recovery mail. Its own bucket + small budget = a flood is capped without
// starving the owner's other mail.
type NotifyNewRequestDeps struct {
	Owners   *repo.Repo
	Proxy    OutboundSender
	Throttle *mailthrottle.Throttle
	Log      *slog.Logger
}

// NotifyOwnerOfNewRequest — best-effort: email the owner that a new access request arrived.
// Never returns an error (the request is already stored); a throttled/unconfigured/failed send
// is logged and swallowed.
func NotifyOwnerOfNewRequest(
	ctx context.Context, deps NotifyNewRequestDeps, ownerID string, req *access.Request,
) {
	if !deps.Throttle.Allow(ctx, notifyKey(ownerID)) {
		deps.Log.Warn("access-request owner notification throttled (email-bomb guard)",
			"owner_id", ownerID)
		return
	}
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

// notifyKey — the throttle's synthetic recipient: the owner id, not their address, so this cap
// lives in its own bucket (see NotifyNewRequestDeps.Throttle).
func notifyKey(ownerID string) string { return "access-request-notify:" + ownerID }

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
