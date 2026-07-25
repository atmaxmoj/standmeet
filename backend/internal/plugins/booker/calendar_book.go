// calendar_book.go —— owner-side calendar booking persistence contract.
//
// The visitor-side booking orchestration that used to live here (BookMeeting +
// policy/freebusy/insert flow) was externalized to the sandbox booker at
// mcp-servers/booker (#135). This file now only holds the store interface + its
// input that the owner-side calendar caps (list_slots / cancel) depend on.

// Package booker holds the booking cluster (owner list_slots / cancel + visitor cancel
// + policy + store contract) drained off the kernel (#135 Slice 4). It reaches calendars
// only through contract.CalendarProxy; concrete proxy + stores are injected at the root.
package booker

import (
	"context"
	"time"
)

// CalendarStore —— 预约持久化 + policy 读取。连接器/凭据/token 在 CalendarProxy
// (internal/connector) 里；这层只碰 booking policy + booking 行。
type CalendarStore interface {
	GetBookingPolicy(ctx context.Context, ownerID string) (BookingPolicy, error)
	CreateBooking(ctx context.Context, in *CreateBookingInput) (CodeBooking, error)
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
