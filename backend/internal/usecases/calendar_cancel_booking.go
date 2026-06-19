// calendar_cancel_booking.go —— E-14c: owner-side calendar.cancel_booking
// usecase。流程:
//   1. GetBookingByID (ownership 校 + 找 google_event_id)
//   2. CalendarProxy.DeleteEvent (404/410 当 OK；凭据/刷新在 proxy 内)
//   3. DeleteBooking (DB hard delete)
//
// 通知：visitor_email 有 → proxy 发取消通知 (sendUpdates=all)，无 → 不发。

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// CancelBookingStore —— CancelBooking 用的窄接口：booking 行存取。连接器/凭据
// 走 CalendarProxy，不再 embed CalendarStore 的 token 部分。
type CancelBookingStore interface {
	GetBookingByID(ctx context.Context, ownerID, bookingID string) (domain.CodeBooking, error)
	DeleteBooking(ctx context.Context, ownerID, bookingID string) error
}

// CancelBookingInput —— owner cancel booking 入参。
type CancelBookingInput struct {
	OwnerID   string
	BookingID string
}

// CancelledBooking —— 返给 caller，让 owner AI 在 Claude Code 看到撤了哪条。
type CancelledBooking struct {
	BookingID    string
	GoogleEvent  string
	Summary      string
	VisitorEmail string
}

// CancelBooking —— 主流程。
func CancelBooking(
	ctx context.Context, proxy CalendarProxy, store CancelBookingStore,
	in *CancelBookingInput,
) (CancelledBooking, error) {
	booking, err := store.GetBookingByID(ctx, in.OwnerID, in.BookingID)
	if err != nil {
		return CancelledBooking{}, fmt.Errorf("get booking: %w", err)
	}
	if dErr := proxy.DeleteEvent(ctx, in.OwnerID, booking.GoogleEventID, booking.VisitorEmail); dErr != nil {
		return CancelledBooking{}, fmt.Errorf("delete gcal event: %w", dErr)
	}
	if delErr := store.DeleteBooking(ctx, in.OwnerID, in.BookingID); delErr != nil {
		return CancelledBooking{}, fmt.Errorf("delete booking row: %w", delErr)
	}
	return CancelledBooking{
		BookingID: booking.ID, GoogleEvent: booking.GoogleEventID,
		Summary: booking.Summary, VisitorEmail: booking.VisitorEmail,
	}, nil
}
