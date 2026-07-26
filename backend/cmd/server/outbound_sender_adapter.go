// outbound_sender_adapter.go —— #135 Slice 5: bridges the mail connector's typed CATEGORY proxy
// (contract.MailProxy) to the kernel's neutral owner.OutboundSender. The kernel sends OTP /
// recovery / booking-confirmation mail through OutboundSender without knowing "mail"/SMTP exists;
// the concrete transport (the active mail connector) is wired here in the composition root.

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

type outboundSenderAdapter struct{ proxy contract.MailProxy }

func (a outboundSenderAdapter) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := a.proxy.Connected(ctx, ownerID)
	if err != nil {
		return false, fmt.Errorf("outbound connected: %w", err)
	}
	return ok, nil
}

func (a outboundSenderAdapter) Send(
	ctx context.Context, ownerID string, msg owner.OutboundMessage,
) error {
	if err := a.proxy.Send(ctx, ownerID, contract.MailMessage{
		To: msg.To, Subject: msg.Subject, Body: msg.Body, HTML: msg.HTML,
	}); err != nil {
		return fmt.Errorf("outbound send: %w", err)
	}
	return nil
}

// outboundSender —— the kernel's neutral sender backed by the active mail connector.
func outboundSender(d *runtimeDeps) outboundSenderAdapter {
	return outboundSenderAdapter{proxy: d.connectorSlots.Mail()}
}
