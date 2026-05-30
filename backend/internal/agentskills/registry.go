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

// OwnerMCPBindings —— 走 registry 拿 owner MCP server 应注册的所有 binding。
// B-4 起 mcp/server.go 改成 walk 这个返回。
func (r *Registry) OwnerMCPBindings() []*MCPBinding {
	caps := r.List()
	out := make([]*MCPBinding, 0, len(caps))
	for _, c := range caps {
		if b := c.OwnerMCPBinding(); b != nil {
			out = append(out, b)
		}
	}
	return out
}
