// codes_booking.go —— #135: 预约配额由 booker 能力自己管(它的 capstore),不进内核 access_code。
// admin 发码/改配额/列表经这个口读写 booker 的 per-code 配置。route 层可认 "booking";内核
// (domain/postgres/capreg)不再有 MaxBookings。组装根注入 booker-backed 实现。

package admin

import (
	"context"
	"log/slog"
)

// BookingQuotaStore —— booker 能力自管的 per-code 预约配额读写口(实现在组装根,落 booker capstore)。
type BookingQuotaStore interface {
	SetMaxBookings(ctx context.Context, codeID string, maxBookings *int32) error
	MaxBookingsOf(ctx context.Context, codeID string) (*int32, error)
}

// writeCodeBookingQuota —— 发码/改配额时把预约上限落 booker(best-effort:失败只 warn,不挡发码)。
func writeCodeBookingQuota(
	ctx context.Context, store BookingQuotaStore,
	log *slog.Logger, codeID string, maxBookings *int32,
) {
	if skipBookingQuota(store, maxBookings) {
		return
	}
	if err := store.SetMaxBookings(ctx, codeID, maxBookings); err != nil {
		log.Warn("set booking quota", "err", err)
	}
}

func skipBookingQuota(store BookingQuotaStore, maxBookings *int32) bool {
	return store == nil || maxBookings == nil
}
