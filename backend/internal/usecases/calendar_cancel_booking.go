// calendar_cancel_booking.go —— E-14c: owner-side calendar.cancel_booking
// usecase。流程:
//   1. GetBookingByID (ownership 校 + 找 google_event_id)
//   2. token refresh (ensureFreshToken 同 BookMeeting)
//   3. gcal.DeleteEvent (404/410 当 OK 处理)
//   4. DeleteBooking (DB hard delete)
//
// sendUpdates 跟 BookMeeting 同：visitor_email 有 → "all"，无 → "none"。

package usecases

import (
	"context"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/gcal"
)

// CancelBookingStore —— CancelBooking 用的窄接口。embed CalendarStore (token
// refresh 走 ensureFreshToken 要 CalendarStore) + 加 GetBookingByID / DeleteBooking。
type CancelBookingStore interface {
	CalendarStore
	GetBookingByID(ctx context.Context, ownerID, bookingID string) (domain.CodeBooking, error)
	DeleteBooking(ctx context.Context, ownerID, bookingID string) error
}

// CancelBookingClient —— CalendarClient + DeleteEvent。*gcal.Client 满足 (它
// 本来就有 InsertEvent/FreeBusy/RefreshToken；E-14c 新加 DeleteEvent)。
type CancelBookingClient interface {
	CalendarClient
	DeleteEvent(ctx context.Context, in *gcal.DeleteEventInput) error
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
	ctx context.Context, client CancelBookingClient, store CancelBookingStore,
	in *CancelBookingInput,
) (CancelledBooking, error) {
	booking, err := store.GetBookingByID(ctx, in.OwnerID, in.BookingID)
	if err != nil {
		return CancelledBooking{}, fmt.Errorf("get booking: %w", err)
	}
	access, tErr := cancelEnsureAccess(ctx, client, store, in.OwnerID)
	if tErr != nil {
		return CancelledBooking{}, tErr
	}
	if dErr := client.DeleteEvent(ctx, &gcal.DeleteEventInput{
		AccessToken: access,
		CalendarID:  "primary",
		EventID:     booking.GoogleEventID,
		SendUpdates: sendUpdatesFor(booking.VisitorEmail),
	}); dErr != nil {
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

// cancelEnsureAccess —— GetConnector + Connected check + ensureFreshToken。
// 拆出来让 CancelBooking cyclo ≤ 5。
func cancelEnsureAccess(
	ctx context.Context, client CalendarClient, store CalendarStore, ownerID string,
) (string, error) {
	conn, cErr := store.GetConnector(ctx, ownerID, domain.CalendarProvider)
	if cErr != nil {
		return "", fmt.Errorf("load connector: %w", cErr)
	}
	if !conn.Connected() {
		return "", domain.ErrCalendarNotConnected
	}
	return ensureFreshToken(ctx, client, store, &conn)
}
