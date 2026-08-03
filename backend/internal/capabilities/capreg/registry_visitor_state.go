// registry_visitor_state.go —— capability → CapabilityState 那一层投影。
//
// 前端 zustand 拿的就是这份列表:哪些能力在、哪些置灰、还剩多少 quota。它跟
// AssembleVisitor 的区别是**不需要一个会话** —— 报得出自己 state 的能力
// (StateReporter)就不用为了这份列表起一个沙箱再关掉(见 registry_tool_dispatch.go)。

package capreg

import (
	"context"
	"errors"
)

// VisitorStates —— 本 session 的 CapabilityState 列表（pi-pivot 前端 zustand 用）。
// enabled=false 的 capability 仍然出现 —— 让前端能渲 "disabled because ..." 提示。
func (r *Registry) VisitorStates(
	ctx context.Context, in *AssembleInput,
) []CapabilityState {
	caps := r.enabledCaps(ctx, in)
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
//
// 报得出 state 的能力(StateReporter)不拨号 —— 为了拿 {id,enabled,quota} 起一个
// 沙箱再关掉,是访客那 19 秒里的一半(见 registry_tool_dispatch.go)。
func visitorStateFor(
	ctx context.Context, c Capability, in *AssembleInput,
) (CapabilityState, bool) {
	if reporter, ok := c.(StateReporter); ok {
		return reportedState(ctx, reporter, c, in)
	}
	return dialedStateFor(ctx, c, in)
}

// dialedStateFor —— 报不出 state 的能力只能实例化一次再读它的 binding。
func dialedStateFor(
	ctx context.Context, c Capability, in *AssembleInput,
) (CapabilityState, bool) {
	b, err := c.VisitorBinding(ctx, in)
	if errors.Is(err, ErrHidden) || b == nil && err == nil {
		return CapabilityState{}, false
	}
	if err != nil {
		state := CapabilityState{ID: c.ID(), Enabled: false}
		setCapTitle(&state, c)
		return state, true
	}
	state := finalizeBindingState(b, c.ID())
	setCapTitle(&state, c)
	return state, true
}

// setCapTitle —— 能力实现 Titled 就把 title 透进 state（disabled 的也带，让 dock 按钮有 label）。
func setCapTitle(state *CapabilityState, c Capability) {
	if t, ok := c.(Titled); ok {
		state.Title = t.Title()
	}
}

// finalizeBindingState —— 从一个已建好的 binding 取 state,顺手把它关掉(这条路只要
// state,会话留着就是泄漏)。
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
