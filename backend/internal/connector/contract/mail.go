// mail.go —— the mail CATEGORY contract (#135 Slice 5), sibling to the calendar contract.
//
// The kernel does NOT use this — it sends through its neutral owner.OutboundSender. This typed
// proxy is the connector axis's mail category surface: the connector adapters implement it, the
// connector-adjacent consumers (owner connectors cap, connector admin/diag routes) program to it,
// and the composition root bridges it to the kernel's OutboundSender.

package contract

import "context"

// MailProxy —— 出站邮件连接器的代调口。ownerID = 句柄;SMTP 凭据从不进消费方。
type MailProxy interface {
	// Connected —— mail 连接器是否可用(有凭据 + OTP 已验)。
	Connected(ctx context.Context, ownerID string) (bool, error)
	// Send —— 用 owner 的邮件连接器发一封信。未配/未连 → 连接器侧 not-configured 错。
	//
	// **回执带 provider 给的 id**（F-C-55）。以前这里只回 error，于是每一份 binding 里那句
	// `response: '{ "id": … }'` 求完就扔 —— 发信的全部回执是「没报错」，而那个 id 是事后
	// 唯一的把手：去 provider 的日志里找这封、对上一次退信、告诉 owner 到底发出去的是哪一封。
	Send(ctx context.Context, ownerID string, msg MailMessage) (MailReceipt, error)
}

// MailReceipt —— 一次发信之后 provider 交回来的东西。
//
// **空的 ProviderID 是一个答案，不是失败**：SMTP 这条路没有可读的 id（250 那行有时带队列号，
// 但那是服务器方言，不是契约能承诺的东西）。所以它是「这条路给不出」而不是「发失败了」——
// 两者别合并（[[empty-is-not-json-null]]）。
type MailReceipt struct {
	// ProviderID —— provider 为这封信发的 id。Mailgun 放在响应体，SendGrid 放在
	// `X-Message-Id` 头 —— **放哪儿由 binding 的 response 映射说了算**，这里只承接结果。
	ProviderID string `json:"provider_id,omitempty"`
}

// MailMessage —— 一封待发的信(无任何 SMTP 凭据)。
type MailMessage struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	HTML    string `json:"html"` // 空 = 纯文本
}
