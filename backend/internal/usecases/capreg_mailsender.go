// capreg_mailsender.go —— mail.send capability 的 host 侧：sandboxed mail-sender 插件经 unix socket
// 调 "send" op，host 跑真 MailContract.Send（落到 active mail 连接器，openapi SaaS 或 SMTP，插件
// 不知）。跟 booker socket 同构。凭据/连接器全在 connector 层，插件只递 session + args。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
)

// MailSenderDeps —— mail.send 的 host 依赖：mail 品类契约（active 连接器分派器）。
type MailSenderDeps struct {
	Proxy MailProxy
}

type mailSendReq struct {
	OwnerID      string          `json:"owner_id"`
	VisitorEmail string          `json:"visitor_email"`
	Args         json.RawMessage `json:"args"`
}

type mailSendArgs struct {
	Recipient string `json:"recipient"`
	Subject   string `json:"subject"`
	Body      string `json:"body"`
}

// RegisterMailSenderSocket —— 把 "send" op 注册到 capsocket server。
func RegisterMailSenderSocket(srv *capsocket.Server, deps *MailSenderDeps) {
	srv.Handle("send", mailSendHandler(deps))
}

type mailSendCall struct {
	OwnerID string
	To      string
	Subject string
	Body    string
}

// parseMailSend —— 解 socket 请求成发信入参。收件人硬控：args.recipient 为空则用访客 session
// email（D-4，防 prompt 注入任意收件人）。
func parseMailSend(raw json.RawMessage) (mailSendCall, error) {
	var req mailSendReq
	if err := json.Unmarshal(raw, &req); err != nil {
		return mailSendCall{}, fmt.Errorf("mail-sender req: %w", err)
	}
	var args mailSendArgs
	if len(req.Args) > 0 {
		if err := json.Unmarshal(req.Args, &args); err != nil {
			return mailSendCall{}, fmt.Errorf("mail-sender args: %w", err)
		}
	}
	to := args.Recipient
	if to == "" {
		to = req.VisitorEmail
	}
	return mailSendCall{OwnerID: req.OwnerID, To: to, Subject: args.Subject, Body: args.Body}, nil
}

// errMailSendFailed —— 发信失败的干净错（capsocket 折成 {"error":...}，不泄底层 SMTP/SaaS 细节）。
var errMailSendFailed = errors.New("the email could not be sent")

// mailSendHandler —— 解参 → MailContract.Send。发信失败 → 干净错（capsocket 折成 {"error":...}）。
func mailSendHandler(deps *MailSenderDeps) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		c, err := parseMailSend(raw)
		if err != nil {
			return nil, err
		}
		if serr := deps.Proxy.Send(ctx, c.OwnerID,
			MailMessage{To: c.To, Subject: c.Subject, Body: c.Body}); serr != nil {
			return nil, errMailSendFailed
		}
		return json.RawMessage(`{"ok":true}`), nil
	}
}
