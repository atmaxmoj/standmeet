// capreg_booker_book.go —— calendar_book host op 的 decode + execute + marshal。
// booker.sock 的 "book" op handler 调 runBookerBook（capreg_booker_socket.go）。
// tool spec / schema 在外置插件 mcp-servers/booker；这里只剩跑活 + wire（不变）。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

func runBookerBook(
	ctx context.Context, deps *BookerDeps, ci *bookerCallInput, input []byte,
) (string, error) {
	args, derr := decodeBookArgs(input)
	if derr != nil {
		return marshalBookErrResult("invalid_args", derr.Error()), nil
	}
	result, berr := BookMeeting(ctx, deps.Proxy, deps.Store, &BookMeetingInput{
		PreferredTimes: args.PreferredTimes,
		OwnerID:        ci.OwnerID,
		OwnerTZ:        ci.OwnerTZ,
		CodeID:         ci.CodeID,
		ConversationID: ci.ConversationID,
		VisitorName:    ci.VisitorName,
		Topic:          args.Topic,
		// 收件人**硬控**走 session profile —— 访客进入时亲手填的 email(#121),
		// 不接受 AI tool 参数。防 prompt 注入让 owner 日历给任意地址发 invite;
		// 没填则空 → buildAttendees 不加任何 attendee。
		VisitorEmail: ci.VisitorEmail,
		DurationMin:  args.DurationMin,
	})
	if berr != nil {
		return marshalBookErr(berr), nil
	}
	// #130: 约成后 best-effort 给 owner 发通知(per-role 开关在 usecase 里实时查)。
	// 通知失败绝不影响 booking 结果(已成);err 吞掉,booking 仍如实返给 agent。
	notifyOwnerBestEffort(ctx, deps, ci, &result, args.Topic)
	return marshalBookResult(&result), nil
}

// notifyOwnerBestEffort —— #130 触发点。ci.RoleID 给 role id;约成的起止 + 访客名
// + 主题进通知。fire-and-forget(无 logger,通知是纯 side-effect)。
func notifyOwnerBestEffort(
	ctx context.Context, deps *BookerDeps, ci *bookerCallInput,
	result *domain.BookResult, topic string,
) {
	if err := NotifyOwnerOfBooking(ctx, deps.Notify, &NotifyOwnerOfBookingInput{
		OwnerID:     ci.OwnerID,
		RoleID:      ci.RoleID,
		VisitorName: ci.VisitorName,
		Topic:       topic,
		StartAt:     result.Start,
		EndAt:       result.End,
	}); err != nil {
		// best-effort:booking 已成,通知失败只记日志,不影响返回给 agent 的结果。
		slog.Default().Warn("owner booking notify failed", "owner_id", ci.OwnerID, "err", err)
	}
}

type bookArgsWire struct {
	Topic          string      `json:"topic"`
	PreferredTimes []time.Time `json:"preferred_times"`
	DurationMin    int         `json:"duration_min"`
}

func decodeBookArgs(input []byte) (bookArgsWire, error) {
	var args bookArgsWire
	if err := json.Unmarshal(input, &args); err != nil {
		return args, fmt.Errorf("decode args: %w", err)
	}
	if verr := validateBookArgs(&args); verr != nil {
		return args, verr
	}
	return args, nil
}

func validateBookArgs(args *bookArgsWire) error {
	if args.Topic == "" {
		return errors.New("missing topic")
	}
	if args.DurationMin < minDurationMin || args.DurationMin > maxDurationMin {
		return fmt.Errorf("duration_min must be %d–%d", minDurationMin, maxDurationMin)
	}
	if len(args.PreferredTimes) == 0 {
		return errors.New("preferred_times required")
	}
	return nil
}

// ───── result encoding —— 跟旧 bookerBundle 同 wire 格式不变 ───────

type bookErrWire struct {
	Error  string `json:"error"`
	Detail string `json:"detail"`
	OK     bool   `json:"ok"`
}

type bookOKWire struct {
	EventID  string `json:"event_id"`
	HTMLLink string `json:"html_link"`
	Start    string `json:"start"`
	End      string `json:"end"`
	OK       bool   `json:"ok"`
}

type bookFailWire struct {
	Conflict    string                  `json:"conflict"`
	PolicyHint  string                  `json:"policy_hint,omitempty"`
	BusyWindows []domain.BookBusyWindow `json:"busy_windows,omitempty"`
	OK          bool                    `json:"ok"`
}

func marshalBookErrResult(reason, detail string) string {
	out, err := json.Marshal(bookErrWire{OK: false, Error: reason, Detail: detail})
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(out)
}

func marshalBookErr(err error) string {
	switch {
	case errors.Is(err, domain.ErrCalendarNotConnected):
		return marshalBookErrResult("not_connected", "owner has not connected a calendar yet")
	case errors.Is(err, domain.ErrCalendarRevoked):
		// reason code carries the keyword so the visitor-facing surface reads
		// human (owner must reconnect their Google Calendar).
		return marshalBookErrResult("calendar_unavailable",
			"the owner's calendar needs to be reconnected — please try again later")
	case errors.Is(err, domain.ErrCalendarUnavailable):
		// 瞬时不可用 + 重试耗尽：友好「稍后再试」，不泄漏底层 5xx / stack。
		return marshalBookErrResult("calendar_unavailable",
			"the calendar service is temporarily unavailable — please try again later")
	default:
		// 未预期的 host-edge / 内部错误（解密失败、plugin→host socket 不可达、句柄构建
		// 失败等）：友好通用降级，绝不把底层错误文本（cipher/nonce/dial unix/stack）泄漏
		// 给访客。真错记日志供 ops 排查（错误流矩阵 E3/E4/E5）。
		slog.Default().Warn("booking degraded on unexpected error", "err", err)
		return marshalBookErrResult("calendar_unavailable",
			"the calendar service is temporarily unavailable — please try again later")
	}
}

func marshalBookResult(r *domain.BookResult) string {
	if r.OK {
		out, err := json.Marshal(bookOKWire{
			OK:       true,
			EventID:  r.EventID,
			HTMLLink: r.HTMLLink,
			Start:    r.Start.Format(time.RFC3339),
			End:      r.End.Format(time.RFC3339),
		})
		if err != nil {
			return `{"ok":false,"error":"marshal_failed"}`
		}
		return string(out)
	}
	out, err := json.Marshal(bookFailWire{
		OK:          false,
		Conflict:    string(r.Reason),
		PolicyHint:  r.PolicyHint,
		BusyWindows: r.BusyWindows,
	})
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(out)
}
