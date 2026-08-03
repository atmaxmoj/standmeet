// outbound.go —— 内核发**确定性**通知(找回、gate 请求获批时把访问码发给申请人)的中性出站口。
//
// 内核这一侧只有这个接口:一个收件人、一个主题、一段正文。它不知道对面是邮件、是 IM、
// 还是别的什么;**这个包里没有 "mail" 也没有 "SMTP" 这两个词**(除了这句说明本身)。
//
// 背后接什么由**组装根**决定,而且接法也是中性的:`cmd/server/port/outbound_sender.go` 把它
// 绑到注册器的 `Invoke(category, verb, argsJSON)` 上 —— 不是绑到某个 typed 的品类代理。
// 差别是编译期的:内核若能写出 `proxy.Send(...)`,它就知道"发信"这件事、知道一封信由
// To/Subject/Body/HTML 构成 —— 名字删掉了,形状还留着。现在它写得出的只有这个接口。

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
