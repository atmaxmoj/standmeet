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
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// connectorOpImpls —— 品类契约操作 → 实现。
func connectorOpImpls(d *deps.Runtime) map[string]fp.Invoke {
	return map[string]fp.Invoke{
		"mail.test_send": mailTestSend(d),
		"calendar.check": calendarCheck(d),
	}
}

// calendarFailureReason —— 归类后的一句话,给 owner 看。跟 mailFailureReason 同一套纪律:
// 每一句都指出下一步,措辞里不放状态码、主机名、栈。
func calendarFailureReason(err error) string {
	switch {
	case errors.Is(err, contract.ErrCalendarNotConnected):
		return "no calendar is connected yet — connect one first"
	case errors.Is(err, contract.ErrCalendarRevoked):
		return "the calendar access was revoked — reconnect it to continue"
	case errors.Is(err, contract.ErrCalendarBadRequest):
		return "the calendar rejected this request — check the booking policy"
	default:
		// 含 ErrCalendarUnavailable 和还没归过类的:对 owner 都是同一件事,等一会儿再试。
		return "couldn't reach the calendar — please try again later"
	}
}

type calendarCheckArgs struct {
	Days int `json:"days"`
}

// calendarCheckOut —— 通了就报**它到底说了什么**(往后看几天、其中几段是忙的),没通就报一句人话。
//
// 为什么回执要带 BusyCount 而不是一句 ok:owner 要判的是「这条链现在还活着吗」,而 "ok" 这个词
// 一个本地短路也答得出来。忙时段的条数只能来自 provider 那一头,所以它才是回执。
type calendarCheckOut struct {
	Reason string `json:"reason,omitempty"`
	// Summary —— 成功那一句,**这个操作自己说**。通用的那一层原本只会说邮件那句
	// 「去收件箱确认」,对日历自检是胡话。
	Summary   string `json:"summary,omitempty"`
	Days      int    `json:"days,omitempty"`
	BusyCount int    `json:"busy_count"`
	OK        bool   `json:"ok"`
}

// checkWindowDays —— 默认往后看多久。一周足够碰到大多数人的日程,又不至于让 provider 慢下来。
const checkWindowDays = 7

// plural —— 回执要读得像句话。「1 busy blocks」会让 owner 停一下去想是不是哪儿错了。
func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// calendarCheck —— 拿存着的凭据向日历问一段 free/busy。
//
// **只读**:不建事件、不改任何东西。一次成功把整条链一起证了 —— 凭据是真的、token 有效或已被
// 透明刷新、scope 够用、账号可达。这正是卡片上那个 "connected" 声称、却从不检查的东西。
//
// 问不到**不是**这台机器的错(授权被撤销 / provider 抖动都算常态),所以回 ok:false 而不是报错:
// owner 要的就是这个答案。
func calendarCheck(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in calendarCheckArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		days := checkWindowDays
		if in.Days > 0 {
			days = in.Days
		}
		now := time.Now().UTC()
		busy, ferr := d.ConnectorSlots.Calendar().FreeBusy(ctx, ownerID, contract.FreeBusyReq{
			TimeMin: now, TimeMax: now.AddDate(0, 0, days),
		})
		if ferr != nil {
			// 原始错误进日志(排查的人要);面上给归类后的一句话。
			d.Log.Warn("connectors.calendar_check", "err", ferr)
			return json.Marshal(calendarCheckOut{OK: false, Reason: calendarFailureReason(ferr)})
		}
		return json.Marshal(calendarCheckOut{
			OK: true, Days: days, BusyCount: len(busy),
			Summary: fmt.Sprintf(
				"The calendar answered — %d busy %s in the next %d days.",
				len(busy), plural(len(busy), "block", "blocks"), days),
		})
	}
}

// mailFailureReason —— 归类后的一句话,给 owner 看。
//
// **每一句都要能指出下一步**:改配置 / 换收件人 / 等一会儿再试。措辞里不放状态码、
// 主机名、栈 —— 那些对 owner 没有意义,而这条消息会一路渲到浏览器上。
func mailFailureReason(err error) string {
	switch {
	case errors.Is(err, consumer.ErrMailNotConfigured):
		return "no mail connector is set up yet — connect one first"
	case errors.Is(err, contract.ErrMailRejected):
		return "the mail provider rejected this message — check the recipient address"
	default:
		// 含 ErrMailUnavailable,也含还没归过类的:两者对 owner 是同一件事 ——
		// 他改不了,过一会儿再试。
		return "couldn't reach the mail provider — please try again later"
	}
}

type mailTestSendArgs struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Text    string `json:"text"`
}

// mailTestSentOut —— 发成了就报是哪种 mail kind 送的(证明发信这条路跟 kind 无关);
// 没发成就报一句**人话的原因**。
//
// Reason 以前不存在:发失败只回 {ok:false}。owner 点了"发一封测试信",面板只能显示
// "失败" —— 是 SMTP 连不上、凭据过期、还是对方拒收这个地址?他分不出来,也就不知道该改什么。
// 一个诊断按钮不给诊断,等于只告诉他"你已经知道的那件事"。
//
// 原因是**归类后的一句话**,不是把 provider 的原始错误透出去:那里面有状态码、主机名、
// 有时还有栈 —— 对 owner 没有意义,对旁观者是情报。
type mailTestSentOut struct {
	ViaKind string `json:"via_kind,omitempty"`
	Reason  string `json:"reason,omitempty"`
	// MessageID —— provider 为这封信发的 id（F-C-55）。**空是一个答案**：SMTP 那条路给不出。
	// 有它 owner 才能拿着去 provider 的日志里对上这一封，而不是只知道"没报错"。
	MessageID string `json:"message_id,omitempty"`
	OK        bool   `json:"ok"`
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
		rcpt, serr := d.ConnectorSlots.Mail().Send(ctx, ownerID,
			contract.MailMessage{To: in.To, Subject: in.Subject, Body: in.Text})
		if serr != nil {
			// 原始错误进日志(owner 要的不是它,排查的人要);面上给归类后的一句话。
			d.Log.Warn("connectors.mail_test_send", "err", serr)
			return json.Marshal(mailTestSentOut{OK: false, Reason: mailFailureReason(serr)})
		}
		return json.Marshal(mailTestSentOut{
			OK: true, ViaKind: d.ConnectorSlots.MailKind(ctx, ownerID),
			MessageID: rcpt.ProviderID,
		})
	}
}
