// uc_booking_store.go —— owner-side calendar booking persistence contract.
//
// The visitor-side booking orchestration that used to live here (BookMeeting +
// policy/freebusy/insert flow) was externalized to the sandbox booker at
// mcp-servers/booker (#135). This file now only holds the store interface + its
// input that the owner-side calendar caps (list_slots / cancel) depend on.
//
// The booking cluster lives with the owner module: bookings are the owner's calendar. It
// reaches calendars only through contract.CalendarProxy; concrete proxy + stores are
// injected at the composition root.

package usecase

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// CalendarStore —— 预约持久化 + policy 读取。连接器/凭据/token 在 CalendarProxy
// (internal/connector) 里；这层只碰 booking policy + booking 行。
type CalendarStore interface {
	GetBookingPolicy(ctx context.Context, ownerID string) (entity.BookingPolicy, error)
	CreateBooking(ctx context.Context, in *CreateBookingInput) (entity.CodeBooking, error)
	CountBookingsForCode(ctx context.Context, codeID string) (int32, error)
}

// CreateBookingInput —— 镜像 postgres.CalendarRepo 的同名 input。
type CreateBookingInput struct {
	StartAt        time.Time
	EndAt          time.Time
	OwnerID        string
	CodeID         string
	ConversationID string
	GoogleEventID  string
	GoogleHTMLLink string
	Summary        string
	VisitorEmail   string
}
