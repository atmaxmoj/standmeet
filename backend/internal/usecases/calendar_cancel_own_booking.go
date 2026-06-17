// calendar_cancel_own_booking.go —— #123: 访客取消**自己约的**会议。
//
// 隔离是核心:访客只给 event_id,后端用 (session owner + code + member) 去解析这笔
// booking —— 仅当 booking 的 conversation 归属同一个 member 才放行,否则
// ErrBookingNotFound(不泄露存在性)。同码跨 member / 跨 code 都被这一道门挡死。
// 解析通过后复用 owner 侧 CancelBooking 的全部流程(token refresh → GCal 删 →
// DB 删),只是前面多一层 member 归属校验。

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// VisitorCancelStore —— owner 侧 cancel 那套 store + 取消隔离门(按 member 解析
// booking)。cmd/server 的 calendarStoreAdapter 满足它。
type VisitorCancelStore interface {
	CancelBookingStore
	BookingForMemberByEvent(
		ctx context.Context, ownerID, codeID, memberID, eventID string,
	) (domain.CodeBooking, error)
}

// VisitorCancelDeps —— 窄依赖(不胖 VisitorDeps):cancel client + member-scoped store。
type VisitorCancelDeps struct {
	Client CancelBookingClient
	Store  VisitorCancelStore
}

// CancelOwnBookingInput —— OwnerID/CodeID/MemberID 来自 session;EventID 来自
// BookCard(google_event_id)。前端不持内部 booking_id —— event_id + session 归属
// 足够定位且无法越权。
type CancelOwnBookingInput struct {
	OwnerID  string
	CodeID   string
	MemberID string
	EventID  string
}

// CancelOwnBooking —— 隔离门 → 复用 owner 侧 CancelBooking。
func CancelOwnBooking(
	ctx context.Context, deps VisitorCancelDeps, in *CancelOwnBookingInput,
) (CancelledBooking, error) {
	booking, err := deps.Store.BookingForMemberByEvent(
		ctx, in.OwnerID, in.CodeID, in.MemberID, in.EventID)
	if err != nil {
		// 越权或不存在都被 store 翻成 ErrBookingNotFound;%w 保留 Is 让 route 翻 404。
		return CancelledBooking{}, fmt.Errorf("resolve own booking: %w", err)
	}
	return CancelBooking(ctx, deps.Client, deps.Store, &CancelBookingInput{
		OwnerID: in.OwnerID, BookingID: booking.ID,
	})
}

// CancelledBooking 与 CancelBooking 的实现见 calendar_cancel_booking.go。
