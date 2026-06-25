// capreg_booker.go —— booker(calendar.book)外置后留在 core 的 host 侧：per-session
// 暴露闸 + book/list_slots 的 pipeline。能力本体（MCP tool / binding / prompt）已外置
// 成沙箱插件 mcp-servers/booker，经 sandbox_stdio 以 origin=builtin 加载；它断网，靠
// bind 进沙箱的窄 socket（booker.sock）回调这里的 host ops 跑真活（capreg_booker_socket.go）。
//
// 这里只剩两类 host 侧东西，都不是 MCP 能力代码：
//   - NewBookerGate：capreg.SessionGate，装配期判 connector-connected + quota，决定
//     tool 是否暴露（mcp-app 适配器在 dial 前调）。connector/store 在 host，闸只能在 host。
//   - runBookerBook / runBookerListSlots（在 _book.go / _slots.go）：socket op handler
//     的 body，复用既有 BookMeeting / ListAvailableSlots。

package usecases

import (
	"context"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

const (
	// capCalendarBook —— capability ID（dotted），也是 role.AllowedTools 的 grant
	// key（role 数据按 "calendar.book" 存）+ 外置插件 manifest 的 ID。
	capCalendarBook = "calendar.book"
	// BookerSkillName —— role.AllowedTools 中此 string 即解锁 calendar.book。
	BookerSkillName = capCalendarBook

	minDurationMin = 15
	maxDurationMin = 180
)

// BookerDeps —— 窄依赖(#131):日历 proxy（连接器代调）+ booking store + owner
// 查询 + 约成通知。凭据/token 在 Proxy 内，这层不碰。gate 只用 Proxy+Store；
// socket op handler 还要 Owners(查 TZ) + Notify(#130)。composition root 建一份，
// 同时喂 NewBookerGate + RegisterBookerSocket。
type BookerDeps struct {
	Proxy  CalendarProxy
	Store  CalendarStore
	Owners OwnerGetter
	Notify OwnerNotifyDeps
	// Confirm —— booked 卡外置后，确认信从 REST 收成 booker tool（send_confirmation，
	// 经 mcp-ui:tool 从卡派发）。复用 SendBookingConfirmation（归属/幂等/D-4 收件人
	// 校验都在里面）。凭据在 MailProxy 内，这层不碰。
	Confirm BookingConfirmDeps
}

// bookerCallInput —— 一次 book / list_slots host op 的 session 派生入参。沙箱插件
// 把 _meta 上的可信 session（host 种的，非 LLM 控的 arguments）转发进 socket 请求，
// op handler 解出来填这个；OwnerTZ 由 handler 自己用 Owners 查（不进 _meta）。
type bookerCallInput struct {
	OwnerID        string
	OwnerTZ        string
	CodeID         string
	ConversationID string
	VisitorName    string
	VisitorEmail   string
	RoleID         string
}

// NewBookerGate —— 装配期 per-session 暴露闸：connector 已连 + quota 未耗尽 → 暴露。
// role grant / mode 已由 mcp-app 适配器的 ACL=role-granted 门把住（role 无 calendar.book
// → 根本不到这），这里只补连接器/配额这两个运行时态。connector/store 在 host，闸天生
// 在 host —— 不是 MCP 能力代码，是插件暴露与否的宿主裁决。proxy==nil（eval 不接日历）→
// 永远隐藏。
func NewBookerGate(deps *BookerDeps) capreg.SessionGate {
	return func(ctx context.Context, in *capreg.AssembleInput) (bool, error) {
		if deps.Proxy == nil || !bookerCanExpose(in) {
			return false, nil
		}
		return bookerGatingClear(ctx, deps, in)
	}
}

// NewBookerStateHook —— 给外置 booker 的 CapabilityState 补 quota_remaining（外置前由
// in-process binding 的 buildCalendarBookBinding 设；mcp-app 适配器的通用 state 不含它）。
// composition root 经 CapHooks.State 注入；装配期实时查 code 剩余可 booking 数，前端用它
// 渲 "还剩 N 次"（tool-endpoint-state-cascade 跨 tool 不变量）。
func NewBookerStateHook(deps *BookerDeps) StateHook {
	return func(ctx context.Context, in *capreg.AssembleInput) capreg.CapabilityState {
		st := capreg.CapabilityState{}
		if rem := bookerQuotaRemaining(ctx, deps, in); rem != nil {
			st.QuotaRemaining = rem
		}
		return st
	}
}

// bookerQuotaRemaining —— 当前 code 剩余可 booking 数。无 cap / DB 错 → nil。
func bookerQuotaRemaining(
	ctx context.Context, deps *BookerDeps, in *capreg.AssembleInput,
) *int32 {
	if in.MaxBookings == nil || *in.MaxBookings <= 0 || in.CodeID == "" {
		return nil
	}
	count, err := deps.Store.CountBookingsForCode(ctx, in.CodeID)
	if err != nil {
		return nil
	}
	rem := max(*in.MaxBookings-count, 0)
	return &rem
}

// bookerCanExpose —— 进入 gating 的最低条件 (mode=code + role granted skill)。
func bookerCanExpose(in *capreg.AssembleInput) bool {
	if in.Mode != "code" {
		return false
	}
	return bookerSkillGranted(in.RoleSnapshot)
}

// bookerSkillGranted —— role 的 union AllowedTools 含 calendar.book。
func bookerSkillGranted(snapshot *domain.RoleSnapshot) bool {
	if snapshot == nil {
		return false
	}
	return slices.Contains(snapshot.AllowedTools(), BookerSkillName)
}

// bookerGatingClear —— quota 未耗尽 → true。**connector-connected 不在此判** —— 已收进
// global 单点闸：calendar 未连 → enabledCaps 据 manifest `Requires:["calendar"]` 直接把整
// 个 calendar.book cap 隐藏（D-2），SessionGate 根本不会被调到。这里只留 booking 专属的
// quota 闸（max_bookings 耗尽 → 隐藏，非 connector 关注点）。
func bookerGatingClear(
	ctx context.Context, deps *BookerDeps, in *capreg.AssembleInput,
) (bool, error) {
	exhausted, qerr := bookerQuotaExhausted(ctx, deps, in)
	if qerr != nil {
		return false, qerr
	}
	return !exhausted, nil
}

// bookerQuotaExhausted —— code 设了 MaxBookings 且当前已 booking >= cap。
func bookerQuotaExhausted(
	ctx context.Context, deps *BookerDeps, in *capreg.AssembleInput,
) (bool, error) {
	if in.MaxBookings == nil || *in.MaxBookings <= 0 || in.CodeID == "" {
		return false, nil
	}
	count, err := deps.Store.CountBookingsForCode(ctx, in.CodeID)
	if err != nil {
		return false, fmt.Errorf("calendar.book: count bookings: %w", err)
	}
	return count >= *in.MaxBookings, nil
}
