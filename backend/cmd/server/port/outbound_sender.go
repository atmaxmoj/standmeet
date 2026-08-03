// outbound_sender.go —— 内核中立的 `owner.OutboundSender` 背后接的是**注册器的通用 Invoke**。
//
// 内核自己要发信(OTP / 找回 / 预约确认),这是 §1.6 承认的场景。但它发信的方式必须是
// **按名字问注册器要一个连接器,再对它 `Invoke(op, argsJSON)`** —— 不是拿一个 typed 的
// `contract.MailProxy`。差别不在优雅:
//
//   - typed proxy 是**编译期**的耦合。内核只要能写出 `proxy.Send(...)`,它就知道有"发信"
//     这件事、知道一封信由 To/Subject/Body/HTML 构成。名字删掉了,形状还在。
//   - `Invoke("send", json)` 是**运行期**按字符串取用。内核写得出的只有一个字符串和一段
//     不透明 JSON;它不知道对面是 SMTP、某个 SaaS,还是根本没接。
//
// 品类名和动词名在这里各出现一次 —— 这里是**组装根**,组装根的职责就是把具体的东西接上去。
// 它们不出现在 `internal/` 的任何地方,那才是要守的线。

package port

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// 组装根在这里把"内核要发信"绑到某个品类的某个动词上。内核侧一个字符串都看不到。
const (
	outboundCategory = "mail"
	opSend           = "send"
	opConnected      = "connected"
)

// categoryInvoker —— 注册器那一口:按品类 + 动词跑一次,收发都是不透明 JSON。
type categoryInvoker interface {
	Invoke(
		ctx context.Context, ownerID, category, verb string, args json.RawMessage,
	) (json.RawMessage, error)
}

// OutboundSenderAdapter —— 把注册器的通用 Invoke 包成内核中立的 OutboundSender。
type OutboundSenderAdapter struct{ inv categoryInvoker }

// Connected —— owner 配没配好可用的出站通道。
func (a OutboundSenderAdapter) Connected(ctx context.Context, ownerID string) (bool, error) {
	raw, err := a.inv.Invoke(ctx, ownerID, outboundCategory, opConnected, json.RawMessage(`{}`))
	if err != nil {
		return false, fmt.Errorf("outbound connected: %w", err)
	}
	// 回参形状由**这一侧的动词**定义(`{"connected":bool}`),组装根照着解。
	var out struct {
		Connected bool `json:"connected"`
	}
	if uerr := json.Unmarshal(raw, &out); uerr != nil {
		return false, fmt.Errorf("outbound connected: decode: %w", uerr)
	}
	return out.Connected, nil
}

// Send —— 发一封信。内核不知道对面是 SMTP 还是某个 SaaS,也不知道它叫 mail。
func (a OutboundSenderAdapter) Send(
	ctx context.Context, ownerID string, msg owner.OutboundMessage,
) error {
	// 线上字段名在这里定死。内核那个 OutboundMessage 是**内核自己的**词汇,没有 json tag;
	// 组装根负责把它翻成对面认得的形状 —— 这正是"翻译归组装根"的意思。
	args, merr := json.Marshal(outboundWire{
		To: msg.To, Subject: msg.Subject, Body: msg.Body, HTML: msg.HTML,
	})
	if merr != nil {
		return fmt.Errorf("outbound send: encode: %w", merr)
	}
	if _, err := a.inv.Invoke(ctx, ownerID, outboundCategory, opSend, args); err != nil {
		return fmt.Errorf("outbound send: %w", err)
	}
	return nil
}

// outboundWire —— 发一封信在**线上**长什么样。它是组装根跟连接器之间的约定,
// 不是内核的类型 —— 内核只有 owner.OutboundMessage,那是它自己的词。
type outboundWire struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	HTML    string `json:"html"`
}

// OutboundSender —— 内核中立的发信口,背后是注册器按名字解出来的那个连接器。
func OutboundSender(d *deps.Runtime) OutboundSenderAdapter {
	return OutboundSenderAdapter{inv: d.ConnectorSlots}
}
