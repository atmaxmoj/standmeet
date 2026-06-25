// capreg_booker_confirm.go —— send_confirmation host op：booked 卡的「发确认邮件」
// widget 点「引用/透传」→ mcp-ui:tool → booker.sock 的 "send_confirmation" op → 这条。
// 复用 SendBookingConfirmation（定位本对话最近一笔预约 → 归属/幂等校验 → D-4 收件人
// 挑选 → owner SMTP 发 → 标记已发）。收件人**硬控**在 backend（session-email 引用 /
// 透传地址），LLM 不经手；凭据在 MailProxy 内，不出 vault。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

type sendConfirmationArgs struct {
	// Recipient —— 透传地址（访客在卡里改写的）；空 → 用 session-email 引用（D-4）。
	Recipient string `json:"recipient"`
	// TZ —— 访客浏览器时区，正文时间按它渲。
	TZ string `json:"tz"`
}

func runBookerSendConfirmation(
	ctx context.Context, deps *BookerDeps, ci *bookerCallInput, input []byte,
) (string, error) {
	var args sendConfirmationArgs
	if derr := json.Unmarshal(input, &args); derr != nil {
		return marshalBookErrResult("invalid_args", derr.Error()), nil
	}
	err := SendBookingConfirmation(ctx, deps.Confirm, &SendBookingConfirmationInput{
		OwnerID:        ci.OwnerID,
		ConversationID: ci.ConversationID,
		CodeID:         ci.CodeID,
		Recipient:      args.Recipient,
		SessionEmail:   ci.VisitorEmail,
		TZ:             args.TZ,
	})
	if err != nil {
		return marshalConfirmationErr(err), nil
	}
	return `{"ok":true}`, nil
}

// confirmationErrCases —— SendBookingConfirmation 的已知错误 → 卡内可读 wire（跟 REST
// booking_confirmation 的 #122 错误码表对齐）。
var confirmationErrCases = []struct {
	err  error
	code string
	msg  string
}{
	{domain.ErrBookingNotFound, "booking_not_found", "no booking found for this conversation"},
	{ErrBookingNoRecipient, "no_recipient", "no email address to send the confirmation to"},
	{ErrBookingConfirmationSent, "already_sent", "confirmation already sent for this booking"},
	{ErrMailNotConfigured, "mail_not_configured", "owner has not configured email yet"},
}

// marshalConfirmationErr —— 已知错误各给明确语义码；其余 → 友好通用降级，不泄漏底层
// 错误文本（cipher/dial/smtp/stack）。真错记日志供 ops。
func marshalConfirmationErr(err error) string {
	for i := range confirmationErrCases {
		if errors.Is(err, confirmationErrCases[i].err) {
			return marshalBookErrResult(confirmationErrCases[i].code, confirmationErrCases[i].msg)
		}
	}
	slog.Default().Warn("send_confirmation degraded on unexpected error", "err", err)
	return marshalBookErrResult("send_failed",
		"couldn't send the confirmation right now — please try again later")
}
