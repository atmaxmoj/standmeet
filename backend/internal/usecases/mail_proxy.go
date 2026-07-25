// mail_proxy.go —— Phase B：出站邮件连接器 proxy 的 **port**。
//
// 凭据永不出 vault：发信这层只拿 ownerID(句柄) + 一封 MailMessage 调 proxy；
// proxy（实现在 internal/connector）内部 load mail 连接器、解密 SMTP 用户名/密码、
// 经 SMTP 发出 —— 密码这串值**从不进 usecases 这层**。usecases 不再 import mailer。

package usecases

import "context"

// MailProxy —— 出站邮件连接器的代调口。ownerID = 句柄。
type MailProxy interface {
	// Connected —— mail 连接器是否可用（有凭据 + OTP 已验）。
	Connected(ctx context.Context, ownerID string) (bool, error)
	// Send —— 用 owner 的 SMTP 连接器发一封信。未配/未连 → ErrMailNotConfigured。
	Send(ctx context.Context, ownerID string, msg MailMessage) error
}

// MailMessage —— 一封待发的信（无任何 SMTP 凭据）。
type MailMessage struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	HTML    string `json:"html"` // 空 = 纯文本
}
