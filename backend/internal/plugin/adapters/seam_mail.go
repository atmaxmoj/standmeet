// seam_mail.go —— the mail SEAM contract (#135 Slice 5), sibling to the calendar contract.
//
// The kernel does NOT use this — it sends through its neutral owner.OutboundSender. This typed
// proxy is the supplier axis's mail seam surface: the supplier adapters implement it, the
// supplier-adjacent consumers (the suppliers panel, supplier admin/diag routes) program to it,
// and the composition root bridges it to the kernel's OutboundSender.

package adapters

import "context"

// MailProxy —— the invocation surface for the outbound mail supplier. ownerID = handle;
// SMTP credentials never reach the consumer.
type MailProxy interface {
	// Connected —— whether the mail supplier is usable (has credentials + OTP verified).
	Connected(ctx context.Context, ownerID string) (bool, error)
	// Send —— send one message through the owner's mail supplier. Not configured/not
	// connected → a supplier-side not-configured error.
	//
	// **The receipt carries the id the provider returns** (F-C-55). Before this, the method
	// returned only an error, so every binding's `response: '{ "id": … }'` extraction was
	// computed then thrown away — the entire receipt for a send was "no error", and that id
	// is the one handle left afterward: to find this message in the provider's logs, match
	// it against a later bounce, and tell the owner exactly which message went out.
	Send(ctx context.Context, ownerID string, msg MailMessage) (MailReceipt, error)
}

// MailReceipt —— what the provider hands back after one send.
//
// **An empty ProviderID is an answer, not a failure**: the SMTP path has no readable id (the
// 250 line sometimes carries a queue number, but that's server dialect, not something the
// contract can promise). So it means "this path can't give one", not "the send failed" —
// don't conflate the two ([[empty-is-not-json-null]]).
type MailReceipt struct {
	// ProviderID —— the id the provider issued for this message. Mailgun puts it in the
	// response body, SendGrid puts it in the `X-Message-Id` header — **where it lives is up
	// to the binding's response mapping**; this field only carries the result.
	ProviderID string `json:"provider_id,omitempty"`
}

// MailMessage —— one message to send (carries no SMTP credentials).
type MailMessage struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	HTML    string `json:"html"` // empty = plain text
}
