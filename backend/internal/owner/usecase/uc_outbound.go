// outbound.go —— 内核发**确定性**邮件(OTP 验证码 / recovery / 预约确认信)的中性出站口。
//
// #135 Slice 5:内核不认识 "mail"/"SMTP" —— 它只持这个中性 OutboundSender 口发信。背后是哪个
// mail 连接器由组装根注入(adapter over contract.MailProxy);SMTP 凭据从不进内核。这跟连接器
// 品类契约(contract.MailProxy)分开:契约在连接器轴、消费者在连接器/路由层;内核只见中性口。

package usecase

import "context"

// OutboundSender —— 发一封确定性邮件的中性口。未配/未连 → 实现侧的 not-configured 错。
type OutboundSender interface {
	// Connected —— 出站通道是否可用(owner 配了并验过发信连接器)。
	Connected(ctx context.Context, ownerID string) (bool, error)
	// Send —— 给 owner 的收件人发一封信。
	Send(ctx context.Context, ownerID string, msg OutboundMessage) error
}

// OutboundMessage —— 一封待发的信(无任何传输层凭据)。
type OutboundMessage struct {
	To      string
	Subject string
	Body    string
	HTML    string // 空 = 纯文本
}
