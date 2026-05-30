// Package agentskills —— 一个 Capability interface + Registry，三处消费：
// visitor chat tools、owner MCP server、system prompt fragments。详见
// [[phase-b-capability-registry]] memory。
//
// B-1 阶段：interface 骨架 + Registry 结构 + 全局 ext-mcp 计数桩。无具体
// capability 注册；retrieval / booker / ext-mcp / owner-skill / job-loop /
// MCP parity 由 B-2..B-6 顺序填入。
//
// 设计约束：
//   - agentskills 是 leaf-ish 包，只依赖 inference + domain + std。具体
//     Capability 实现放在 usecases / mcp 包里，反向 import 本包注册。
//   - 高层 Capability 实现是闭包形态：构造时持有自己的 deps，VisitorBinding
//     只接 per-session 上下文（AssembleInput），不接 deps —— 类型安全，
//     避免 any。
package agentskills

import (
	"context"
	"encoding/json"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
)

// Shape —— 一个 capability 暴露给哪一侧。
type Shape string

// Shape 枚举值；invariants spec 断言 visitor_only ↔ 不出现在 owner MCP，
// owner_only ↔ 不出现在 visitor session，both ↔ 两侧都出现。
const (
	ShapeVisitorOnly Shape = "visitor_only"
	ShapeOwnerOnly   Shape = "owner_only"
	ShapeBoth        Shape = "both"
)

// AssembleInput —— 装配一次 visitor session 时的上下文。Capability 自身
// 持有 deps (闭包)，只接收 per-session 字段。
type AssembleInput struct {
	RoleSnapshot *domain.RoleSnapshot
	MaxBookings  *int32
	OwnerID      string
	Mode         string
	CodeID       string
}

// Binding —— visitor 侧某 capability 在一次 session 中的实例化。
//
// nil（VisitorBinding 返 nil）= capability 不暴露给本 session（比如
// calendar 未装、role 没含 skill）。registry 装配时 nil binding 完全
// 不出现在 tool spec 与 capability map 里。
//
// Close 可选；持外部资源（ext MCP 长连接等）的 binding 在 session
// 结束时由 registry 统一调用。无资源就 nil。
type Binding struct {
	Execute inference.ToolExecutor
	Close   func()
	Spec    inference.ToolSpec
	State   CapabilityState
}

// CapabilityState —— pi-pivot 用：一次 session 颁发时回前端 zustand。
// QuotaRemaining / PolicySummary 是 self-describing，让 LLM 与 UI 都能
// 同源读。Extra 留 capability 自由发挥（policy details / connector status
// 等结构化数据），但保持可序列化。
type CapabilityState struct {
	QuotaRemaining *int32          `json:"quota_remaining,omitempty"`
	ID             string          `json:"id"`
	PolicySummary  string          `json:"policy_summary,omitempty"`
	Extra          json.RawMessage `json:"extra,omitempty"`
	Enabled        bool            `json:"enabled"`
}

// Capability —— 一个能力的统一注册口。三处消费方都通过它读。
type Capability interface {
	ID() string
	Shape() Shape
	VisitorBinding(ctx context.Context, in *AssembleInput) (*Binding, error)
	OwnerMCPBinding() *MCPBinding
	SystemPromptFragment(ctx context.Context, in *AssembleInput) string
}
