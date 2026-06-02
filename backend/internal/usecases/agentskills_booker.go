// agentskills_booker.go —— Phase B-3: calendarBookCapability。
// 包住 BookMeeting + connector/quota gating + visitor name 透传，让 visitor
// chat agent 通过 calendar.book tool 把会议直接写进 owner Google Calendar。
//
// Shape=visitor_only；OwnerMCPBinding=nil (owner 自己有 admin UI 排 connector
// + Google 端日历，不通过 MCP 调本 tool)。

package usecases

import (
	"context"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/prompts"
)

const (
	// capCalendarBook —— capability ID (internal 层级概念，dotted)。仍用
	// 作 role.AllowedTools 的 grant key (role 数据已经按 "calendar.book"
	// 存)，D-3 不动这个。
	capCalendarBook           = "calendar.book"
	capCalendarBookFragmentID = "capabilities/calendar.book"
	// toolCalendarBookName —— LLM-facing tool name + URL path segment。D-3
	// 切到 snake_case 跟 corpus_search/read/list 一致 (URL `/tools/{name}`
	// 1:1)；cap ID / role grant key 仍 dotted (data 稳定)。
	toolCalendarBookName = "calendar_book"
	// toolCalendarListSlotsName —— G-7: visitor 想"看一眼 owner 有哪些
	// 空"。复用 owner-side ListAvailableSlots usecase；result wire 跟
	// owner cap_calendar 用同形态 ({slots:[{start,end}]})。
	toolCalendarListSlotsName = "calendar_list_slots"
	// BookerSkillName —— role.AllowedTools 中此 string 即解锁 calendar.book。
	BookerSkillName = capCalendarBook

	minDurationMin = 15
	maxDurationMin = 180
)

type calendarBookCapability struct {
	deps *VisitorDeps
}

func newCalendarBookCapability(deps *VisitorDeps) *calendarBookCapability {
	return &calendarBookCapability{deps: deps}
}

func (*calendarBookCapability) ID() string { return capCalendarBook }
func (*calendarBookCapability) Shape() agentskills.Shape {
	return agentskills.ShapeVisitorOnly
}

func (*calendarBookCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{}
}

func (*calendarBookCapability) SystemPromptFragmentID(
	_ context.Context, in *agentskills.AssembleInput,
) string {
	if !bookerSkillGranted(in.RoleSnapshot) {
		return ""
	}
	return capCalendarBookFragmentID
}

func (c *calendarBookCapability) SystemPromptFragment(
	ctx context.Context, in *agentskills.AssembleInput,
) string {
	id := c.SystemPromptFragmentID(ctx, in)
	if id == "" {
		return ""
	}
	// Phase D-1: 单一源 prompts/capabilities/calendar.book.md
	return prompts.MustLoad(id)
}

// VisitorBinding —— 完整 gating 链：role granted skill → connector connected →
// quota not exhausted → load owner profile。任一不过 = 返 ErrHidden (capability
// 隐藏)。Quota 已耗尽时也隐藏（兼容旧行为，让 LLM 看不到调不通的 tool）。
func (c *calendarBookCapability) VisitorBinding(
	ctx context.Context, in *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	if !bookerCanExpose(in) || c.deps.Calendar == nil {
		return nil, agentskills.ErrHidden
	}
	return c.tryBuildBinding(ctx, in)
}

// tryBuildBinding —— 拆出 VisitorBinding 余下的 gating + 装配逻辑让
// 父 cyclo ≤ 5。
func (c *calendarBookCapability) tryBuildBinding(
	ctx context.Context, in *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	connected, qerr := bookerGatingClear(ctx, c.deps, in)
	if qerr != nil {
		return nil, qerr
	}
	if !connected {
		return nil, agentskills.ErrHidden
	}
	owner, oerr := c.deps.Owners.GetByID(ctx, in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf("calendar.book: load owner: %w", oerr)
	}
	return buildCalendarBookBinding(ctx, c.deps, in, &owner), nil
}

// bookerCanExpose —— 进入 gating 的最低条件 (mode=code + role granted skill)。
func bookerCanExpose(in *agentskills.AssembleInput) bool {
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

// bookerGatingClear —— connector 已 connected 且 quota 未耗尽 → true。
// 返 (gating_pass, err)。connector 未装 / quota 耗尽 → (false, nil)；DB 错
// → (false, err)。
func bookerGatingClear(
	ctx context.Context, deps *VisitorDeps, in *agentskills.AssembleInput,
) (bool, error) {
	conn, err := deps.Calendar.GetConnector(ctx, in.OwnerID, domain.CalendarProvider)
	if err != nil {
		return false, fmt.Errorf("calendar.book: load connector: %w", err)
	}
	if !conn.Connected() {
		return false, nil
	}
	exhausted, qerr := bookerQuotaExhausted(ctx, deps, in)
	if qerr != nil {
		return false, qerr
	}
	return !exhausted, nil
}

// bookerQuotaExhausted —— code 设了 MaxBookings 且当前已 booking >= cap。
func bookerQuotaExhausted(
	ctx context.Context, deps *VisitorDeps, in *agentskills.AssembleInput,
) (bool, error) {
	if in.MaxBookings == nil || *in.MaxBookings <= 0 || in.CodeID == "" {
		return false, nil
	}
	count, err := deps.Calendar.CountBookingsForCode(ctx, in.CodeID)
	if err != nil {
		return false, fmt.Errorf("calendar.book: count bookings: %w", err)
	}
	return count >= *in.MaxBookings, nil
}

// buildCalendarBookBinding —— gating 通过后的最终 Binding：每个 tool 独立
// 闭包，eino tool.InvokableTool；BindingTool.NewTool 内部把 name+desc+
// schema 装成 *schema.ToolInfo 喂 eino。
//
// G-7 起两个 tool: calendar_book + calendar_list_slots (read-only，不
// 走 quota)。
func buildCalendarBookBinding(
	ctx context.Context, deps *VisitorDeps,
	in *agentskills.AssembleInput, owner *domain.Owner,
) *agentskills.Binding {
	state := agentskills.CapabilityState{
		ID: capCalendarBook, Enabled: true,
	}
	if rem := bookerQuotaRemaining(ctx, deps, in); rem != nil {
		state.QuotaRemaining = rem
	}
	bookRun := func(ctx context.Context, args string) (string, error) {
		return runBookerBook(ctx, deps, in, owner, []byte(args))
	}
	slotsRun := func(ctx context.Context, args string) (string, error) {
		return runBookerListSlots(ctx, deps, in, owner, []byte(args))
	}
	return &agentskills.Binding{
		Tools: []agentskills.BindingTool{
			bookerBindingTool(bookRun),
			listSlotsBindingTool(slotsRun),
		},
		State: state,
	}
}

// bookerQuotaRemaining —— 当前 code 剩余可 booking 数。无 cap / DB 错 → nil。
// 已知 quota 未耗尽（gating 通过到这里），但 LiveCount 仍可能跟 cap 差距。
func bookerQuotaRemaining(
	ctx context.Context, deps *VisitorDeps, in *agentskills.AssembleInput,
) *int32 {
	if in.MaxBookings == nil || *in.MaxBookings <= 0 || in.CodeID == "" {
		return nil
	}
	count, err := deps.Calendar.CountBookingsForCode(ctx, in.CodeID)
	if err != nil {
		return nil
	}
	rem := max(*in.MaxBookings-count, 0)
	return &rem
}

// bookerBindingTool / listSlotsBindingTool 在各自分文件 (max-lines 350
// cap)；buildCalendarBookBinding 上方调用，分发 by tool 各自一个 closure。

// runBookerBook + book-side 类型/decode/marshal 全部拆到
// agentskills_booker_book.go；runBookerListSlots + list_slots-side 全
// 部拆到 agentskills_booker_slots.go。
