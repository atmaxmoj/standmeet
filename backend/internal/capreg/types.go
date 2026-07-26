// Package capreg —— 一个 Capability interface + Registry，三处消费：
// visitor chat tools、owner MCP server、system prompt fragments。详见
// [[phase-b-capability-registry]] memory。
//
// B-1 阶段：interface 骨架 + Registry 结构 + 全局 ext-mcp 计数桩。无具体
// capability 注册；retrieval / booker / ext-mcp / owner-skill / job-loop /
// MCP parity 由 B-2..B-6 顺序填入。
//
// 设计约束：
//   - capreg 是 leaf-ish 包，只依赖 inference + domain + std。具体
//     Capability 实现放在 usecases / mcp 包里，反向 import 本包注册。
//   - 高层 Capability 实现是闭包形态：构造时持有自己的 deps，VisitorBinding
//     只接 per-session 上下文（AssembleInput），不接 deps —— 类型安全，
//     避免 any。
package capreg

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/accessdomain"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

// ErrHidden —— VisitorBinding 返此 sentinel 表示 capability 不暴露给本
// session (干净路径，跟"真错"区分)。registry silently skip；VisitorStates
// 也跳过不进 capability map。
var ErrHidden = errors.New("capreg: capability hidden from session")

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
	OwnerID        string
	Mode           string
	CodeID         string
	Visitor        accessdomain.VisitorProfile
	ConversationID string
}

// BindingTool 定义挪到 binding_tool.go (H.8: 走 eino tool.InvokableTool
// canonical 接口)。Capability 可暴露多个 tool (如 corpus.retrieval 暴
// 露 search/read/list 三个)，共享同一 CapabilityState (per-capability
// 状态比 per-tool 自然)。

// Binding —— visitor 侧某 capability 在一次 session 中的实例化。
//
// nil（VisitorBinding 返 nil）= capability 不暴露给本 session（比如
// calendar 未装、role 没含 skill）。registry 装配时 nil binding 完全
// 不出现在 tool spec 与 capability map 里。
//
// Close 可选；持外部资源（ext MCP 长连接等）的 binding 在 session
// 结束时由 registry 统一调用。无资源就 nil。
//
// （旧 Cited 字段已删：citation 早就由 inference 的 accumSink 从 corpus_read 结果
// {id,genre} 自行累计，跟能力解耦；retrieval 外置后该字段成死代码，随之删除。）
type Binding struct {
	Close func()
	Tools []BindingTool
	State CapabilityState
}

// CapabilityState —— pi-pivot 用：一次 session 颁发时回前端 zustand。
// QuotaRemaining / PolicySummary 是 self-describing，让 LLM 与 UI 都能
// 同源读。Extra 留 capability 自由发挥（policy details / connector status
// 等结构化数据），但保持可序列化。
type CapabilityState struct {
	QuotaRemaining *int32 `json:"quota_remaining,omitempty"`
	ID             string `json:"id"`
	// Title —— 人类可读显示名，透传 MCP 工具的 title（#109/#110 dock 按钮 label 用）。
	// 无 fallback：能力没实现 Titled 就空，那它不够格当 dock 按钮 label。
	Title         string          `json:"title,omitempty"`
	PolicySummary string          `json:"policy_summary,omitempty"`
	Extra         json.RawMessage `json:"extra,omitempty"`
	Enabled       bool            `json:"enabled"`
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
//
// SystemPromptFragmentID (D-2 加) —— 若 capability 当前 session 贡献一段
// 来自 prompts/ 的 fragment，返 fragment id (相对路径无后缀，e.g.
// "capabilities/corpus.retrieval")，否则返 ""。空判定逻辑必须跟
// SystemPromptFragment 的"返非空文本"判定同步 —— 让前端 part_ids 跟
// 后端 ComposeSystemPrompt 的实际拼接结果一一对应。
type Capability interface {
	ID() string
	Shape() Shape
	VisitorBinding(ctx context.Context, in *AssembleInput) (*Binding, error)
	OwnerMCPBindings() []*MCPBinding
	SystemPromptFragment(ctx context.Context, in *AssembleInput) string
	SystemPromptFragmentID(ctx context.Context, in *AssembleInput) string
}

// SessionGate —— an optional per-session exposure predicate for a plugin whose
// tool visibility depends on RUNTIME state the manifest can't express. The
// externalized booker uses it: role-grant alone isn't enough — the owner's
// calendar connector must be connected AND the access code's booking quota not
// exhausted, else the tool stays hidden (chat-book-not-connected /
// chat-book-quota-exhausted). It is wired host-side by the composition root
// (where the connector proxy + store live) and consulted by the mcp-app adapter
// in VisitorBinding, BEFORE dialing the sandbox. Returns (expose, err): false →
// ErrHidden; a real err propagates. nil gate = no extra gating (the default).
type SessionGate func(ctx context.Context, in *AssembleInput) (bool, error)
