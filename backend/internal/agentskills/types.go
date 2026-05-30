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
	"errors"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
)

// ErrHidden —— VisitorBinding 返此 sentinel 表示 capability 不暴露给本
// session (干净路径，跟"真错"区分)。registry silently skip；VisitorStates
// 也跳过不进 capability map。
var ErrHidden = errors.New("agentskills: capability hidden from session")

// AssembleInput —— 装配一次 visitor session 时的上下文。Capability 自身
// 持有 deps (闭包)，只接收 per-session 字段。
//
// 同路径：dev endpoint 跟 real SendMessage 走同一 AssembleVisitor（cap 实现
// 内部不能按 caller 是 test 还是 prod 分支 —— 违反 [[feedback-always-clean]]
// 同路径原则）。capability 有 "shape-only" 需求时（ext-mcp 不想 dial 来取
// tool name），应该在 register 时把 shape 缓存好。
//
// ConversationID 在 dev endpoint introspection 时为空（无对话上下文）；
// real SendMessage 时为当前消息所在 conv。
type AssembleInput struct {
	RoleSnapshot   *domain.RoleSnapshot
	MaxBookings    *int32
	OwnerID        string
	Mode           string
	CodeID         string
	VisitorName    string
	ConversationID string
}

// BindingTool —— 一个 Capability 暴露的一个 LLM tool。Capability 可暴露
// 多个 tool（如 corpus.retrieval 暴露 search/read/list 三个），共享同一
// CapabilityState (per-capability 状态比 per-tool 自然)。
type BindingTool struct {
	Execute inference.ToolExecutor
	Spec    inference.ToolSpec
}

// Binding —— visitor 侧某 capability 在一次 session 中的实例化。
//
// nil（VisitorBinding 返 nil）= capability 不暴露给本 session（比如
// calendar 未装、role 没含 skill）。registry 装配时 nil binding 完全
// 不出现在 tool spec 与 capability map 里。
//
// Close 可选；持外部资源（ext MCP 长连接等）的 binding 在 session
// 结束时由 registry 统一调用。无资源就 nil。
//
// Cited 可选；retrieval-style capability 提供，emitDoneEvent 在 stream
// 结束后调用拿真读过的 entries。
type Binding struct {
	Close func()
	Cited func() CitedSnapshot
	Tools []BindingTool
	State CapabilityState
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
//
// VisitorBinding 返 (nil, ErrHidden) 表示该 session 不暴露本 capability
// (calendar 未装 / role 没含 skill / ext server 不可达等)；区别于
// (nil, realErr) 真错。registry 装配时 ErrHidden silently skip。
//
// OwnerMCPBindings 返 0+ MCPBinding —— 一个 capability 可暴露多 owner MCP
// tool (例 seo.bundle 暴露 seo.set_wiki_slug + seo.update_settings)；
// 无返空 slice 表示该 capability 不暴露 owner MCP 面。
type Capability interface {
	ID() string
	Shape() Shape
	VisitorBinding(ctx context.Context, in *AssembleInput) (*Binding, error)
	OwnerMCPBindings() []*MCPBinding
	SystemPromptFragment(ctx context.Context, in *AssembleInput) string
}
