// access_request_notify.go — the outbound channel for owner submission-notifications.
//
// It's the same OutboundSender as everything else, plus a dedicated burst cap. The cap lives
// HERE, not in the domain: throttling is a property of the send channel (like the per-recipient
// cap already inside OutboundSenderAdapter), and the composition root is the one place allowed to
// know the mechanism. The domain just calls Send; a dropped send comes back as a no-op.

package port

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/mailthrottle"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// accessRequestNotifyBurst — max owner-notification emails per hour on a flood of access-request
// submissions. Its OWN bucket (keyed on owner id below), separate from the base sender's
// per-address throttle, so a flood can't drain the budget the owner needs for OTP / recovery mail.
// Small on purpose: "someone asked for access" is not urgent enough for the 30/hour default.
const accessRequestNotifyBurst = 5

// BurstThrottledSender — the base sender plus a dedicated per-owner burst cap. Keyed on owner id
// (a synthetic recipient), NOT the recipient address, so it's a separate bucket from the base
// sender's per-address throttle. Over budget → drop the send (nil, best-effort); same fail-open
// contract as the base throttle.
type BurstThrottledSender struct {
	OutboundSenderAdapter

	burst *mailthrottle.Throttle
}

// Send — burst-cap first, then the base send (which applies its own per-recipient cap).
func (s BurstThrottledSender) Send(
	ctx context.Context, ownerID string, n owner.OutboundNotice,
) error {
	if !s.burst.Allow(ctx, "access-request-notify:"+ownerID) {
		s.log.Warn("access-request owner notification throttled (email-bomb guard)",
			"owner_id", ownerID)
		return nil
	}
	return s.OutboundSenderAdapter.Send(ctx, ownerID, n)
}

// AccessRequestNotifySender — the outbound channel for owner submission-notifications: the base
// sender wrapped with the dedicated small burst cap (email-bomb defense).
func AccessRequestNotifySender(d *deps.Runtime) BurstThrottledSender {
	return BurstThrottledSender{
		OutboundSenderAdapter: OutboundSender(d),
		burst: mailthrottle.NewWithBudget(
			mailthrottle.RedisCounter{RDB: d.RDB}, accessRequestNotifyBurst, time.Hour,
		),
	}
}
