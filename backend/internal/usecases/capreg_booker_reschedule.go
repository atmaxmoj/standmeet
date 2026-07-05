// capreg_booker_reschedule.go —— calendar_reschedule host op：访客把**自己本对话**那笔预约改到
// 一个新的 owner-available 时间。
//
// 原子性靠**先订新、再删旧**：新 slot 订失败（冲突 / 政策 / 日历不可用）→ 原预约**完好无损**、
// 返失败给访客；只有新的确实订成了，才删旧那笔（旧 slot 随之释放）。删旧失败 best-effort：新的
// 已成立，只记日志、绝不回滚（宁可留一条 stray 旧 event，也不把访客的新时间弄丢）。
//
// 隔离同 book/cancel：走 host 种的 ConversationID（非 LLM 控），resolveConvBooking 只取**本对话**
// 那笔 —— 别的对话 / 别的访客拿到不同 ConversationID，动不了这笔预约。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

type rescheduleArgs struct {
	// EventID —— 卡上的 google_event_id；防御性校它确属本对话那笔（不持内部 booking_id）。
	EventID        string      `json:"event_id"`
	PreferredTimes []time.Time `json:"preferred_times"`
	DurationMin    int         `json:"duration_min"`
}

func runBookerReschedule(
	ctx context.Context, deps *BookerDeps, ci *bookerCallInput, input []byte,
) (string, error) {
	d := decodeRescheduleArgs(input)
	if d.errWire != "" {
		return d.errWire, nil
	}
	old := resolveConvBooking(ctx, deps, ci, d.args.EventID)
	if old.errWire != "" {
		return old.errWire, nil
	}
	return execReschedule(ctx, deps, ci, &old.booking, &d.args)
}

// decodedReschedule —— 单返回值（避 unnamedResult ↔ nonamedreturns 拉锯，同 convBooking）。
// errWire 非空 = 该直接回的友好错误（空 = ok，用 args）。
type decodedReschedule struct {
	errWire string
	args    rescheduleArgs
}

func decodeRescheduleArgs(input []byte) decodedReschedule {
	var args rescheduleArgs
	if err := json.Unmarshal(input, &args); err != nil {
		return decodedReschedule{errWire: marshalBookErrResult("invalid_args", err.Error())}
	}
	if len(args.PreferredTimes) == 0 {
		return decodedReschedule{
			errWire: marshalBookErrResult("invalid_args", "preferred_times required"),
		}
	}
	if args.DurationMin < minDurationMin || args.DurationMin > maxDurationMin {
		return decodedReschedule{errWire: marshalBookErrResult("invalid_args",
			fmt.Sprintf("duration_min must be %d–%d", minDurationMin, maxDurationMin))}
	}
	return decodedReschedule{args: args}
}

// execReschedule —— 先订新（复用 book 的 policy+freebusy+conflict），成了再删旧。
func execReschedule(
	ctx context.Context, deps *BookerDeps, ci *bookerCallInput,
	old *domain.CodeBooking, args *rescheduleArgs,
) (string, error) {
	result, berr := BookMeeting(ctx, deps.Proxy, deps.Store, rescheduleBookInput(ci, old, args))
	if berr != nil {
		return marshalBookErr(berr), nil
	}
	if !result.OK {
		// 冲突 / 政策 / 全忙：原预约不动，把失败原样返给访客（可再挑别的时间）。
		return marshalBookResult(&result, ci.VisitorEmail, false), nil
	}
	cancelOldBestEffort(ctx, deps, ci.OwnerID, old.ID)
	return marshalBookResult(&result, ci.VisitorEmail, ownerCanEmail(ctx, deps, ci.OwnerID)), nil
}

// rescheduleBookInput —— 新预约沿用旧的主题（同一场会，只换时间）：Topic=old.Summary、
// VisitorName 置空，buildSummary 便原样用 old.Summary，不重复前缀。收件人仍硬控走 session（#121）。
func rescheduleBookInput(
	ci *bookerCallInput, old *domain.CodeBooking, args *rescheduleArgs,
) *BookMeetingInput {
	return &BookMeetingInput{
		PreferredTimes: args.PreferredTimes,
		OwnerID:        ci.OwnerID,
		OwnerTZ:        ci.OwnerTZ,
		CodeID:         ci.CodeID,
		ConversationID: ci.ConversationID,
		VisitorName:    "",
		Topic:          old.Summary,
		VisitorEmail:   ci.VisitorEmail,
		DurationMin:    args.DurationMin,
	}
}

// cancelOldBestEffort —— 新已订成后删旧那笔。失败绝不回滚新的（宁留 stray 旧 event）；记日志供 ops。
func cancelOldBestEffort(ctx context.Context, deps *BookerDeps, ownerID, bookingID string) {
	if _, cerr := CancelBooking(ctx, deps.Cancel.Proxy, deps.Cancel.Store, &CancelBookingInput{
		OwnerID: ownerID, BookingID: bookingID,
	}); cerr != nil {
		slog.Default().Warn("reschedule: new booked but old cancel failed (stray old event)",
			"err", cerr, "old_booking", bookingID)
	}
}
