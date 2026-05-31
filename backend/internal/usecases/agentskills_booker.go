// agentskills_booker.go —— Phase B-3: calendarBookCapability。
// 包住 BookMeeting + connector/quota gating + visitor name 透传，让 visitor
// chat agent 通过 calendar.book tool 把会议直接写进 owner Google Calendar。
//
// Shape=visitor_only；OwnerMCPBinding=nil (owner 自己有 admin UI 排 connector
// + Google 端日历，不通过 MCP 调本 tool)。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/prompts"
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

// buildCalendarBookBinding —— gating 通过后的最终 Binding：tool spec +
// executor 闭包 (执行 BookMeeting) + state (quota_remaining 计算)。
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
	exec := makeBookerExecutor(deps, in, owner)
	return &agentskills.Binding{
		Tools: []agentskills.BindingTool{{Spec: bookerToolSpec(), Execute: exec}},
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

func bookerToolSpec() inference.ToolSpec {
	return inference.ToolSpec{
		Name: toolCalendarBookName,
		Description: "Book a meeting on the owner's Google Calendar. " +
			"Only call after you have gathered topic, duration (15-180 minutes), " +
			"and one or more visitor-confirmed preferred start times in RFC3339 " +
			"format. Optionally include a visitor_email so Google sends the " +
			"calendar invite.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"topic":{"type":"string"},
				"duration_min":{"type":"integer","minimum":15,"maximum":180},
				"preferred_times":{
					"type":"array",
					"items":{"type":"string","description":"RFC3339"},
					"minItems":1
				},
				"visitor_email":{"type":"string","format":"email"}
			},
			"required":["topic","duration_min","preferred_times"]
		}`),
	}
}

func makeBookerExecutor(
	deps *VisitorDeps, in *agentskills.AssembleInput, owner *domain.Owner,
) inference.ToolExecutor {
	return func(ctx context.Context, name string, input []byte) (string, error) {
		if name != toolCalendarBookName {
			return "", fmt.Errorf("calendar_book: unknown tool %q", name)
		}
		args, derr := decodeBookArgs(input)
		if derr != nil {
			return marshalBookErrResult("invalid_args", derr.Error()), nil
		}
		result, berr := BookMeeting(ctx, deps.GCal, deps.Calendar, &BookMeetingInput{
			PreferredTimes: args.PreferredTimes,
			OwnerID:        in.OwnerID,
			OwnerTZ:        owner.ProfileTimezone,
			CodeID:         in.CodeID,
			ConversationID: in.ConversationID,
			VisitorName:    in.VisitorName,
			Topic:          args.Topic,
			VisitorEmail:   args.VisitorEmail,
			DurationMin:    args.DurationMin,
		})
		if berr != nil {
			return marshalBookErr(berr), nil
		}
		return marshalBookResult(&result), nil
	}
}

type bookArgsWire struct {
	Topic          string      `json:"topic"`
	VisitorEmail   string      `json:"visitor_email"`
	PreferredTimes []time.Time `json:"preferred_times"`
	DurationMin    int         `json:"duration_min"`
}

func decodeBookArgs(input []byte) (bookArgsWire, error) {
	var args bookArgsWire
	if err := json.Unmarshal(input, &args); err != nil {
		return args, fmt.Errorf("decode args: %w", err)
	}
	if verr := validateBookArgs(&args); verr != nil {
		return args, verr
	}
	return args, nil
}

func validateBookArgs(args *bookArgsWire) error {
	if args.Topic == "" {
		return errors.New("missing topic")
	}
	if args.DurationMin < minDurationMin || args.DurationMin > maxDurationMin {
		return fmt.Errorf("duration_min must be %d–%d", minDurationMin, maxDurationMin)
	}
	if len(args.PreferredTimes) == 0 {
		return errors.New("preferred_times required")
	}
	return nil
}

// ───── result encoding —— 跟旧 bookerBundle 同 wire 格式不变 ───────

type bookErrWire struct {
	Error  string `json:"error"`
	Detail string `json:"detail"`
	OK     bool   `json:"ok"`
}

type bookOKWire struct {
	EventID  string `json:"event_id"`
	HTMLLink string `json:"html_link"`
	Start    string `json:"start"`
	End      string `json:"end"`
	OK       bool   `json:"ok"`
}

type bookFailWire struct {
	Conflict    string                  `json:"conflict"`
	PolicyHint  string                  `json:"policy_hint,omitempty"`
	BusyWindows []domain.BookBusyWindow `json:"busy_windows,omitempty"`
	OK          bool                    `json:"ok"`
}

func marshalBookErrResult(reason, detail string) string {
	out, err := json.Marshal(bookErrWire{OK: false, Error: reason, Detail: detail})
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(out)
}

func marshalBookErr(err error) string {
	switch {
	case errors.Is(err, domain.ErrCalendarNotConnected):
		return marshalBookErrResult("not_connected", "owner has not connected a calendar yet")
	case errors.Is(err, domain.ErrCalendarRevoked):
		return marshalBookErrResult("revoked", "owner calendar authorization has been revoked")
	default:
		return marshalBookErrResult("internal_error", err.Error())
	}
}

func marshalBookResult(r *domain.BookResult) string {
	if r.OK {
		out, err := json.Marshal(bookOKWire{
			OK:       true,
			EventID:  r.EventID,
			HTMLLink: r.HTMLLink,
			Start:    r.Start.Format(time.RFC3339),
			End:      r.End.Format(time.RFC3339),
		})
		if err != nil {
			return `{"ok":false,"error":"marshal_failed"}`
		}
		return string(out)
	}
	out, err := json.Marshal(bookFailWire{
		OK:          false,
		Conflict:    string(r.Reason),
		PolicyHint:  r.PolicyHint,
		BusyWindows: r.BusyWindows,
	})
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(out)
}
