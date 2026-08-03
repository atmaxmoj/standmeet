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

import (
	"context"
	"errors"
)

// ErrOutboundNotConfigured —— owner 还没配好可用的出站通道,送不出去。
//
// **内核自己的哨兵**。以前这里用的是连接器轴导出的 `consumer.ErrMailNotConfigured` ——
// 一个跨界的、名字里带 mail 的错误:内核只要 errors.Is 它一次,就等于承认自己知道对面是邮件。
// 组装根负责把渠道侧的对应错误翻成这个(见 cmd/server/port/outbound_sender.go)。
var ErrOutboundNotConfigured = errors.New("no outbound channel configured")

// OutboundSender —— 送一条确定性通知的中性口。未配/未连 → ErrOutboundNotConfigured。
type OutboundSender interface {
	// Connected —— 出站通道是否可用(owner 配了并验过)。
	Connected(ctx context.Context, ownerID string) (bool, error)
	// Send —— 把一条通知送到某个收件人手上。
	Send(ctx context.Context, ownerID string, n OutboundNotice) error
	// ChannelName —— 送不出去时,让 owner 去连**哪一种**连接器。
	//
	// 这个字符串由**装配根**给(它才知道这台实例把出站绑到了哪个品类),内核只是转述。
	// 有它之前,消息里写的是"an outbound channel" —— 一个界面上根本不存在的词:
	// owner 读完不知道去哪儿、找什么。**错误消息里的名词必须是他在屏幕上找得到的那个。**
	ChannelName() string
}

// OutboundNotice —— 一条待送的通知。**这是内核能表达的全部**:送给谁、一句标题、一段正文。
//
// 三个字段都是**渠道无关**的:邮件把 Title 当主题行,IM 当首行,推送当通知标题。原来这里还有
// 一个 `HTML` 字段(邮件的 text/html alternative),那是**只有邮件才有的概念** —— 而且从来
// 没有任何调用方填过它。它留在这儿的唯一作用,就是让内核仍然写得出"一封信"。
type OutboundNotice struct {
	// To —— 收件人在那条渠道上的地址。内核不解析它,也不知道它是邮箱还是别的什么。
	To string
	// Title —— 一句话的标题。
	Title string
	// Body —— 正文纯文本。
	Body string
}
