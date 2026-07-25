// mail.go —— the mail CATEGORY contract (#135 Slice 5), sibling to the calendar contract.
//
// The kernel does NOT use this — it sends through its neutral usecases.OutboundSender. This typed
// proxy is the connector axis's mail category surface: the connector adapters implement it, the
// connector-adjacent consumers (owner connectors cap, connector admin/diag routes) program to it,
// and the composition root bridges it to the kernel's OutboundSender.

package contract

import "context"

// MailProxy —— 出站邮件连接器的代调口。ownerID = 句柄;SMTP 凭据从不进消费方。
type MailProxy interface {
	// Connected —— mail 连接器是否可用(有凭据 + OTP 已验)。
	Connected(ctx context.Context, ownerID string) (bool, error)
	// Send —— 用 owner 的 SMTP 连接器发一封信。未配/未连 → 连接器侧 not-configured 错。
	Send(ctx context.Context, ownerID string, msg MailMessage) error
}

// MailMessage —— 一封待发的信(无任何 SMTP 凭据)。
type MailMessage struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	HTML    string `json:"html"` // 空 = 纯文本
}
