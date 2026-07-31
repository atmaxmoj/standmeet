// booking_store_deps.go —— /bookings 列表的存储依赖。
//
// 预约**策略**不在这儿了:它是 booker 这个外置能力自己的配置,字段和默认值声明在 booker 的
// manifest(Config),值存在 booker 自己的隔离存储,面板经通用的 capability-config 口读写
// (capability_config.go)。host 不再认识 "booking policy" —— 以前它认识,而且那份跟沙箱那份
// 已经飘了(host 说工作到 18:00、缓冲 15 分钟,沙箱按 17:00、缓冲 0)。
//
// 剩下的这一条是**数据列表**,不是配置:owner 想看约成了哪些会。

package admin

import (
	"context"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// BookingLister —— admin bookings list 的存储口。#187:绑定到 booker 的隔离 capstore(约成的会
// 存那,老 code_bookings 表已不接 chat 预约)。composition root 注入 capstore-backed 实现。
type BookingLister interface {
	ListBookingsByOwner(
		ctx context.Context, ownerID string, limit int32,
	) ([]owner.CodeBooking, error)
}

// CalendarAdminDeps —— booking 列表路由的存储依赖（仅预约记录，非连接器、非策略）。
type CalendarAdminDeps struct {
	Repo BookingLister
}
