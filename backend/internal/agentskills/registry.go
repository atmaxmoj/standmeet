// registry.go —— Capability 集中注册口。注册顺序就是装配顺序（确定性，
// system prompt hash 依赖之）。
//
// 三个 walk 入口：
//   - List —— 注册顺序回 capability 副本
//   - AssembleVisitor —— per-session 装配出 binding 序列（含 Close）
//   - OwnerMCPBindings —— owner MCP server 装配用的 binding 序列
//
// AssembleVisitor 失败 silently skip；caller 注入 log（B-2 起加 log hook）。

package agentskills

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

// Registry —— Capability 注册口。Register 撞 ID 返错；boot 期用
// MustRegister 让启动失败比运行时漏注册好。
type Registry struct {
	seen map[string]bool
	caps []Capability
	mu   sync.RWMutex
}

// NewRegistry —— 新建空 Registry。
func NewRegistry() *Registry {
	return &Registry{seen: map[string]bool{}}
}

// Register —— 注册一个 capability。ID 撞名 / 空 ID 返错。
func (r *Registry) Register(c Capability) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	id := c.ID()
	if id == "" {
		return errors.New("agentskills: capability with empty ID")
	}
	if r.seen[id] {
		return fmt.Errorf("agentskills: duplicate capability ID %q", id)
	}
	r.seen[id] = true
	r.caps = append(r.caps, c)
	return nil
}

// MustRegister —— Register 失败 panic（boot 期使用，启动失败比运行时漏
// 注册好）。
func (r *Registry) MustRegister(c Capability) {
	if err := r.Register(c); err != nil {
		panic(err)
	}
}

// List —— 注册顺序返回 capability 副本（外部不能 mutate 内部 slice）。
func (r *Registry) List() []Capability {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Capability, len(r.caps))
	copy(out, r.caps)
	return out
}

// AssembleVisitor —— 给定 session 装配该 session 可见的 binding 集合。
// ErrHidden = capability 主动隐藏 (干净路径，silently skip)；其他错误也
// silently skip (装配失败不阻塞 chat)；都返非 nil binding 才进结果。
// 返回顺序与 Register 顺序一致。
func (r *Registry) AssembleVisitor(
	ctx context.Context, in *AssembleInput,
) []*Binding {
	caps := r.List()
	out := make([]*Binding, 0, len(caps))
	for _, c := range caps {
		b, err := c.VisitorBinding(ctx, in)
		if err != nil || b == nil {
			continue
		}
		out = append(out, b)
	}
	return out
}

// VisitorStates —— AssembleVisitor 之后只取 CapabilityState 列表（pi-pivot
// 前端 zustand 用）。enabled=false 的 capability 仍然出现 —— 让前端能渲
// "disabled because ..." 提示。
func (r *Registry) VisitorStates(
	ctx context.Context, in *AssembleInput,
) []CapabilityState {
	caps := r.List()
	out := make([]CapabilityState, 0, len(caps))
	for _, c := range caps {
		if state, ok := visitorStateFor(ctx, c, in); ok {
			out = append(out, state)
		}
	}
	return out
}

// visitorStateFor —— 返 (state, true) = 该 capability 应出现在前端
// capability map；返 (_, false) = 该 capability 完全不暴露 (ErrHidden 或
// nil binding)。其他 error = 暴露但 enabled=false (让前端能渲降级提示)。
func visitorStateFor(
	ctx context.Context, c Capability, in *AssembleInput,
) (CapabilityState, bool) {
	b, err := c.VisitorBinding(ctx, in)
	if errors.Is(err, ErrHidden) || b == nil && err == nil {
		return CapabilityState{}, false
	}
	if err != nil {
		return CapabilityState{ID: c.ID(), Enabled: false}, true
	}
	return finalizeBindingState(b, c.ID()), true
}

func finalizeBindingState(b *Binding, capID string) CapabilityState {
	state := b.State
	if state.ID == "" {
		state.ID = capID
	}
	if b.Close != nil {
		b.Close()
	}
	return state
}

// VisitorHeaderFragmentID —— 永远是 system prompt 第一段 (visitor-header.md)。
// 由 Registry 集中导出，避免 caller 各处硬编码。
const VisitorHeaderFragmentID = "visitor-header"

// VisitorToolSpec —— frontend 看到的 tool 描述 (LLM tool API shape)。
// H.8 之后由 BindingTool.Tool.Info() (eino schema.ToolInfo) +
// BindingTool.InputSchema (raw JSON Schema) + BindingTool.ProgressLabel
// 组合而成；wire 形态稳定不变。
//
// ProgressLabel —— G-8: tool 跑过程中 frontend throbber 显的文案
// ("searching corpus" / "reading entry" / ...)。空字符串 → frontend
// fallback "running <name>"。让 label 跟 tool 注册同源，去掉前端两份硬
// 编码 THROBBER_LABELS 重复。omitempty 保证 wire 干净。
type VisitorToolSpec struct {
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	ProgressLabel string          `json:"progress_label,omitempty"`
	InputSchema   json.RawMessage `json:"input_schema"`
}

// VisitorToolSpecs —— per-session 跑一遍 AssembleVisitor 拿到所有 enabled
// capability 的 tool spec 列表 (name + description + progress_label +
// input_schema)，让前端 pi-agent-core 知道往 LLM 注哪些 tool + throbber 怎
// 么显。Close hook 顺手释放 (一次性查询)。
func (r *Registry) VisitorToolSpecs(
	ctx context.Context, in *AssembleInput,
) []VisitorToolSpec {
	bindings := r.AssembleVisitor(ctx, in)
	out := make([]VisitorToolSpec, 0)
	for _, b := range bindings {
		for i := range b.Tools {
			out = append(out, toolToVisitorSpec(ctx, &b.Tools[i]))
		}
		if b.Close != nil {
			b.Close()
		}
	}
	return out
}

// toolToVisitorSpec —— BindingTool → VisitorToolSpec 投射。Name 直接读
// BindingTool.Name (NewTool 时 stash 的快照)；Description 走 Tool.Info()
// 拿；InputSchema + ProgressLabel 是 standmeet 自加的 sidecar。
func toolToVisitorSpec(ctx context.Context, t *BindingTool) VisitorToolSpec {
	return VisitorToolSpec{
		Name:          t.Name,
		Description:   bindingToolDescription(ctx, t),
		ProgressLabel: t.ProgressLabel,
		InputSchema:   t.InputSchema,
	}
}

func bindingToolDescription(ctx context.Context, t *BindingTool) string {
	info, ierr := t.Tool.Info(ctx)
	if ierr != nil || info == nil {
		return ""
	}
	return info.Desc
}

// VisitorPromptPartIDs —— 当前 session 实际拼进 system prompt 的 fragment id
// 顺序：[VisitorHeaderFragmentID] + [每个 capability 非空 fragment id]。
// 前端 pi-agent-core 按此顺序 GET /api/v1/prompts/{id} 拿文本本地拼，跟
// 后端 ComposeSystemPrompt 的拼接顺序一致 (注册顺序 = walk 顺序)。
//
// "非空" 判定走 capability.SystemPromptFragmentID —— 跟
// SystemPromptFragment 同一 gating 逻辑，cap 实现负责保持一致。
//
// 注意：base persona 中 role.PromptBody + skillPrompts 是 DB 内容，没有
// 文件 id，本列表不含；前端拿这两段要靠别的字段 (D-4 时定形)。
func (r *Registry) VisitorPromptPartIDs(
	ctx context.Context, in *AssembleInput,
) []string {
	caps := r.List()
	out := make([]string, 0, 1+len(caps))
	out = append(out, VisitorHeaderFragmentID)
	for _, c := range caps {
		if id := c.SystemPromptFragmentID(ctx, in); id != "" {
			out = append(out, id)
		}
	}
	return out
}

// OwnerMCPBindings —— 走 registry 拿 owner MCP server 应注册的所有 binding。
// B-4 起 mcp/server.go 改成 walk 这个返回；plural 让一个 capability 可
// 一次暴露多个 tool (seo / jobs / writings 等多 tool family)。
func (r *Registry) OwnerMCPBindings() []*MCPBinding {
	caps := r.List()
	out := make([]*MCPBinding, 0, len(caps))
	for _, c := range caps {
		out = append(out, c.OwnerMCPBindings()...)
	}
	return out
}
