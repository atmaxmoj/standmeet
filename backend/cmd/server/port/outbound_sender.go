// outbound_sender.go —— #135 Slice 5: bridges the mail connector's typed CATEGORY proxy
// (contract.MailProxy) to the kernel's neutral owner.OutboundSender. The kernel sends OTP /
// recovery / booking-confirmation mail through OutboundSender without knowing "mail"/SMTP exists;
// the concrete transport (the active mail connector) is wired here in the composition root.

package port

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// OutboundSenderAdapter —— 把邮件连接器的品类代理包成内核中立的 OutboundSender。
type OutboundSenderAdapter struct{ proxy contract.MailProxy }

// Connected —— owner 配没配好可用的邮件连接器。
func (a OutboundSenderAdapter) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := a.proxy.Connected(ctx, ownerID)
	if err != nil {
		return false, fmt.Errorf("outbound connected: %w", err)
	}
	return ok, nil
}

// Send —— 经 active 邮件连接器发一封信;内核不知道对面是 SMTP 还是某个 SaaS。
func (a OutboundSenderAdapter) Send(
	ctx context.Context, ownerID string, msg owner.OutboundMessage,
) error {
	if err := a.proxy.Send(ctx, ownerID, contract.MailMessage{
		To: msg.To, Subject: msg.Subject, Body: msg.Body, HTML: msg.HTML,
	}); err != nil {
		return fmt.Errorf("outbound send: %w", err)
	}
	return nil
}

// OutboundSender —— the kernel's neutral sender backed by the active mail connector.
func OutboundSender(d *deps.Runtime) OutboundSenderAdapter {
	return OutboundSenderAdapter{proxy: d.ConnectorSlots.Mail()}
}
