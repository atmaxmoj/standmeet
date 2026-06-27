// booking_store_deps.go —— booking 路由（/bookings list + /booking-policy）的存储依赖。
// #155 后日历**连接器**已归一到统一 connector 层（slot 分派器），这里只剩**预约持久化**——
// 沿用 CalendarRepo 的 booking 方法（GetBookingPolicy / ListBookingsByOwner / Upsert…）。

package admin

import "github.com/atmaxmoj/standmeet/internal/postgres"

// CalendarAdminDeps —— booking 路由的存储依赖（仅预约存储，非连接器）。
type CalendarAdminDeps struct {
	Repo *postgres.CalendarRepo
}
