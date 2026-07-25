// booking_store_deps.go —— booking 路由（/bookings list + /booking-policy）的存储依赖。
// #135:booker 外置到沙箱后,booking policy 是 booker **自有**数据(存它的隔离 capstore);
// owner 经 /booking-policy(owner GUI,两个允许引用点之一)读写,走 Policy 这个绑定好的存储
// (composition root 注入,内部打 booker 的 capstore)。核心不再认 "booking policy"。

package admin

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/plugins/booker"
)

// BookingPolicyStore —— owner 的预约政策读写(绑定到 booker 的隔离存储)。没设过 → 返默认。
type BookingPolicyStore interface {
	Get(ctx context.Context, ownerID string) (booker.BookingPolicy, error)
	Set(ctx context.Context, ownerID string, p *booker.BookingPolicy) error
}

// BookingLister —— admin bookings list 的存储口。#187:绑定到 booker 的隔离 capstore(约成的会
// 存那,老 code_bookings 表已不接 chat 预约)。composition root 注入 capstore-backed 实现。
type BookingLister interface {
	ListBookingsByOwner(
		ctx context.Context, ownerID string, limit int32,
	) ([]booker.CodeBooking, error)
}

// CalendarAdminDeps —— booking 路由的存储依赖（仅预约存储，非连接器）。
type CalendarAdminDeps struct {
	Repo   BookingLister
	Policy BookingPolicyStore
}
