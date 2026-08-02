// impls.go —— 连接器在 manifest 里声明的 owner 操作,在这一侧的实现。
//
// 声明和实现分两处是有意的:声明是**数据**(连接器自己的 manifest 说它出哪个操作、长什么样),
// 实现按**品类契约**接上(mail.test_send → contract.MailProxy)。通用注册表因此不认识任何
// 品类;认识品类的只有这张表,而这一侧本来就是放两根插件轴的地方。
//
// manifest 声明了一个这里没有的 op = 启动就炸(见 connectorDeclaredOps),不会等到 owner
// 点下去才发现。

package axisconn

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// connectorOpImpls —— 品类契约操作 → 实现。
func connectorOpImpls(d *deps.Runtime) map[string]fp.Invoke {
	return map[string]fp.Invoke{
		"mail.test_send": mailTestSend(d),
	}
}

type mailTestSendArgs struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Text    string `json:"text"`
}

// mailTestSentOut —— 发成了就报是哪种 mail kind 送的(证明发信这条路跟 kind 无关)。
type mailTestSentOut struct {
	ViaKind string `json:"via_kind,omitempty"`
	OK      bool   `json:"ok"`
}

// mailTestSend —— 经当前激活的邮件连接器发一封测试信。
//
// 发不出去**不是**这台机器的错(SMTP 挂了 / 凭据不对都算常态),所以回 ok:false 而不是报错:
// owner 要的就是这个答案。
func mailTestSend(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in mailTestSendArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"to", in.To}); err != nil {
			return nil, err
		}
		serr := d.ConnectorSlots.Mail().Send(ctx, ownerID,
			contract.MailMessage{To: in.To, Subject: in.Subject, Body: in.Text})
		if serr != nil {
			d.Log.Warn("connectors.mail_test_send", "err", serr)
			return json.Marshal(mailTestSentOut{OK: false})
		}
		return json.Marshal(mailTestSentOut{
			OK: true, ViaKind: d.ConnectorSlots.MailKind(ctx, ownerID),
		})
	}
}
