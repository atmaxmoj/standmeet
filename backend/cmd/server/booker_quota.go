// booker_quota.go —— booker 的 per-code 预约配额闸(host 侧)。
//
// 上限跟计数都在 booker 自己的 capstore(code_config / bookings):能力自己管自己,内核不认识
// "booking"。这里只有两个钩子 —— Gate 决定 tool 露不露,State 把剩余次数填进 capability_state
// (前端按它显示配额)。两者共用同一条计数,不各算各的。
//
// 从 booker_gateway.go 拆出来:那个文件同时装着 policy store / code config / capstore 适配器 /
// 网关接线,配额是其中自成一体的一块,拆开后两边都在 350 行闸之内。

package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"
)

// bookerQuotaGate —— #135:quota 闸留在 host,上限从 booker 自己的 capstore("code_config")读、
// count 也在自己的 "bookings" 数(能力自己管自己;内核不再有 MaxBookings)。达上限 → 隐藏 tool
// (hide,不 error-on-use)。无配置/无上限/无 code → 不闸。核心仍不认 "booking"。
func bookerQuotaGate(d *runtimeDeps) capreg.SessionGate {
	store := capstore.New(d.db)
	return func(ctx context.Context, in *capreg.AssembleInput) (bool, error) {
		return bookingWithinQuota(ctx, store, in.CodeID)
	}
}

// bookerQuotaState —— 把剩余可预约次数填进 capability_state.quota_remaining。
//
// #135 把 booker 外置时,Gate 和 State 两个钩子一起被摘掉,之后只补回了 Gate ——
// quota_remaining 从此永远是 nil,而前端(zustand)和 per-tool 端点契约仍然承诺这个字段。
// 契约还在,供给没了:这是"名字说谎"的一种,tool-endpoint-* 两条 spec 正是撞在这上面。
// 计数复用 Gate 用的同一条 bookerBookingCount —— 一份口径,不另起第二套算法。
// 无上限/无 code/读失败 → 不填(omitempty),而不是填 0:0 会被读成"已用尽"。
func bookerQuotaState(d *runtimeDeps) capload.StateHook {
	store := capstore.New(d.db)
	return func(ctx context.Context, in *capreg.AssembleInput) capreg.CapabilityState {
		st := capreg.CapabilityState{ID: bookerCapID, Enabled: true}
		cfg, cerr := bookingCodeConfigOf(ctx, store, in.CodeID)
		if cerr != nil || noBookingLimit(cfg) {
			return st
		}
		count, err := bookerBookingCount(ctx, store, in.CodeID)
		if err != nil {
			return st
		}
		// 夹到 0:超额(count > 上限)时报负数会被前端读成一个奇怪的余额。
		left := max(*cfg.MaxBookings-int32(count), 0)
		st.QuotaRemaining = &left
		return st
	}
}

func bookingWithinQuota(ctx context.Context, store *capstore.Store, codeID string) (bool, error) {
	cfg, cerr := bookingCodeConfigOf(ctx, store, codeID)
	if cerr != nil {
		return false, cerr
	}
	if noBookingLimit(cfg) {
		return true, nil
	}
	count, err := bookerBookingCount(ctx, store, codeID)
	if err != nil {
		return false, err
	}
	return count < int64(*cfg.MaxBookings), nil
}

func noBookingLimit(cfg *bookingCodeConfig) bool {
	return cfg == nil || cfg.MaxBookings == nil || *cfg.MaxBookings <= 0
}

func bookerBookingCount(ctx context.Context, store *capstore.Store, codeID string) (int64, error) {
	filter, merr := json.Marshal(map[string]string{"code_id": codeID})
	if merr != nil {
		return 0, fmt.Errorf("booker quota filter: %w", merr)
	}
	count, cerr := store.Count(ctx, bookerCapKind, bookerCapID, "bookings", filter)
	if cerr != nil {
		return 0, fmt.Errorf("booker quota count: %w", cerr)
	}
	return count, nil
}
