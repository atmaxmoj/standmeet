// capreg_booker_book.go —— calendar_book tool 的 spec + decode +
// execute + marshal。从 capreg_booker.go 拆出来守 max-lines 350 cap。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

// bookerBindingTool —— calendar_book 注册口；caller 给一个 closure
// 处理实际 booking，本函数装好 name/desc/progress_label/schema。
func bookerBindingTool(run capreg.RunFn) capreg.BindingTool {
	return capreg.NewTool(
		toolCalendarBookName,
		"Book a meeting on the owner's Google Calendar. "+
			"Only call after you have gathered topic, duration (15-180 minutes), "+
			"and one or more visitor-confirmed preferred start times in RFC3339 "+
			"format. The invite goes to the email the visitor gave when they "+
			"entered (if any) — you do not supply a recipient.",
		"booking meeting",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"topic":{"type":"string"},
				"duration_min":{"type":"integer","minimum":15,"maximum":180},
				"preferred_times":{
					"type":"array",
					"items":{"type":"string","description":"RFC3339"},
					"minItems":1
				}
			},
			"required":["topic","duration_min","preferred_times"]
		}`),
		run,
	)
}

func runBookerBook(
	ctx context.Context, deps bookerDeps, in *capreg.AssembleInput,
	owner *domain.Owner, input []byte,
) (string, error) {
	args, derr := decodeBookArgs(input)
	if derr != nil {
		return marshalBookErrResult("invalid_args", derr.Error()), nil
	}
	result, berr := BookMeeting(ctx, deps.Proxy, deps.Store, &BookMeetingInput{
		PreferredTimes: args.PreferredTimes,
		OwnerID:        in.OwnerID,
		OwnerTZ:        owner.ProfileTimezone,
		CodeID:         in.CodeID,
		ConversationID: in.ConversationID,
		VisitorName:    in.Visitor.Name,
		Topic:          args.Topic,
		// 收件人**硬控**走 session profile —— 访客进入时亲手填的 email(#121),
		// 不接受 AI tool 参数。防 prompt 注入让 owner 日历给任意地址发 invite;
		// 没填则空 → buildAttendees 不加任何 attendee。
		VisitorEmail: in.Visitor.Email,
		DurationMin:  args.DurationMin,
	})
	if berr != nil {
		return marshalBookErr(berr), nil
	}
	// #130: 约成后 best-effort 给 owner 发通知(per-role 开关在 usecase 里实时查)。
	// 通知失败绝不影响 booking 结果(已成);err 吞掉,booking 仍如实返给 agent。
	notifyOwnerBestEffort(ctx, deps, in, &result, args.Topic)
	return marshalBookResult(&result), nil
}

// notifyOwnerBestEffort —— #130 触发点。RoleSnapshot 给 role id;约成的起止 + 访客名
// + 主题进通知。fire-and-forget(无 logger,通知是纯 side-effect)。
func notifyOwnerBestEffort(
	ctx context.Context, deps bookerDeps, in *capreg.AssembleInput,
	result *domain.BookResult, topic string,
) {
	roleID := ""
	if in.RoleSnapshot != nil {
		roleID = in.RoleSnapshot.RoleID()
	}
	if err := NotifyOwnerOfBooking(ctx, deps.Notify, &NotifyOwnerOfBookingInput{
		OwnerID:     in.OwnerID,
		RoleID:      roleID,
		VisitorName: in.Visitor.Name,
		Topic:       topic,
		StartAt:     result.Start,
		EndAt:       result.End,
	}); err != nil {
		// best-effort:booking 已成,通知失败只记日志,不影响返回给 agent 的结果。
		slog.Default().Warn("owner booking notify failed", "owner_id", in.OwnerID, "err", err)
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
		return marshalBookErrResult("revoked", "owner calendar authorization has been revoked")
	default:
		return marshalBookErrResult("internal_error", err.Error())
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
