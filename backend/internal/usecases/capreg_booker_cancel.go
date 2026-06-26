// capreg_booker_cancel.go —— calendar_cancel host op：booked 卡的「取消」按钮点下
// → mcp-ui:tool → booker.sock 的 "cancel" op → 这条。隔离靠 host 种的 ConversationID
// （非 LLM 控）：只取**本对话**那笔预约，访客撤不了别人的。复用 CancelBooking
// （删 GCal event + DB 行；凭据在 CalendarProxy 内）。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

type cancelArgs struct {
	// EventID —— 卡上的 google_event_id；防御性校它确属本对话那笔（不持内部 booking_id）。
	EventID string `json:"event_id"`
}

func runBookerCancel(
	ctx context.Context, deps *BookerDeps, ci *bookerCallInput, input []byte,
) (string, error) {
	var args cancelArgs
	if derr := json.Unmarshal(input, &args); derr != nil {
		return marshalBookErrResult("invalid_args", derr.Error()), nil
	}
	r := resolveConvBooking(ctx, deps, ci, args.EventID)
	if r.errWire != "" {
		return r.errWire, nil
	}
	if _, cerr := CancelBooking(ctx, deps.Cancel.Proxy, deps.Cancel.Store, &CancelBookingInput{
		OwnerID: ci.OwnerID, BookingID: r.booking.ID,
	}); cerr != nil {
		return marshalCancelErr(cerr), nil
	}
	return `{"ok":true,"cancelled":true}`, nil
}

// convBooking —— resolveConvBooking 的单返回值（避开 unnamedResult ↔ nonamedreturns
// 拉锯）。errWire 非空 = 该直接回的友好错误（空 = ok，用 booking）。
type convBooking struct {
	booking domain.CodeBooking
	errWire string
}

// resolveConvBooking —— 取本对话那笔预约并防御性校 event_id 归属。
func resolveConvBooking(
	ctx context.Context, deps *BookerDeps, ci *bookerCallInput, eventID string,
) convBooking {
	booking, berr := deps.Confirm.Calendar.LatestBookingForConversation(ctx, ci.ConversationID)
	if berr != nil {
		return convBooking{errWire: marshalCancelErr(berr)}
	}
	if eventID != "" && eventID != booking.GoogleEventID {
		return convBooking{
			errWire: marshalBookErrResult("booking_not_found", "no matching booking to cancel"),
		}
	}
	return convBooking{booking: booking}
}

// marshalCancelErr —— 没有可取消的预约 → 明确语义；其余 → 友好通用降级，不泄漏底层
// 错误文本（gcal/connection/stack）。真错记日志供 ops。
func marshalCancelErr(err error) string {
	if errors.Is(err, domain.ErrBookingNotFound) {
		return marshalBookErrResult("booking_not_found", "no booking found to cancel")
	}
	slog.Default().Warn("calendar_cancel degraded on unexpected error", "err", err)
	return marshalBookErrResult("cancel_failed",
		"couldn't cancel the meeting right now — please try again later")
}
