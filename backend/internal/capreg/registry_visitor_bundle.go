// registry_visitor_bundle.go —— /sessions 的一次性 visitor 装配。
//
// /sessions 同时要 States + ToolSpecs + PromptPartIDs。原来分别调 VisitorStates
// + VisitorToolSpecs 会把每个外置插件**冷拨两遍**(各自一趟 VisitorBinding)。两个
// 真实网络沙箱插件时 = 4 次冷拨,把一次 /sessions 顶到 ~16s(超 e2e 15s 等待)。这里
// 每个 cap 只 VisitorBinding 一次,state 与 tool spec 共用同一次拨号。语义跟三方法
// 逐一调完全一致(顺序、隐藏/禁用判定、prompt-part 与 binding 解耦都不变)。

package capreg

import (
	"context"
	"errors"
)

// VisitorBundle —— 一次 walk 产出的三样投影。
type VisitorBundle struct {
	States        []CapabilityState
	ToolSpecs     []VisitorToolSpec
	PromptPartIDs []string
}

// AssembleVisitorBundle —— 每个 cap 只 VisitorBinding 一次,一趟 walk 出
// States + ToolSpecs + PromptPartIDs。/sessions 用它替代分别调三方法(那样每个
// 外置插件被冷拨两遍)。
func (r *Registry) AssembleVisitorBundle(
	ctx context.Context, in *AssembleInput,
) VisitorBundle {
	caps := r.enabledCaps(ctx, in)
	b := VisitorBundle{
		States:        make([]CapabilityState, 0, len(caps)),
		ToolSpecs:     make([]VisitorToolSpec, 0),
		PromptPartIDs: make([]string, 0, 1+len(caps)),
	}
	b.PromptPartIDs = append(b.PromptPartIDs, VisitorHeaderFragmentID)
	for _, c := range caps {
		accumVisitorCap(ctx, c, in, &b)
	}
	return b
}

// accumVisitorCap —— 把一个 capability 折进 bundle:prompt-part-id 跟 binding 解耦
// (与 VisitorPromptPartIDs 同源,不拨号);binding 拨一次,active 同时贡献 state +
// tool specs,disabled 只贡献 enabled=false 的 state,hidden 啥都不贡献。
func accumVisitorCap(
	ctx context.Context, c Capability, in *AssembleInput, b *VisitorBundle,
) {
	appendPromptPart(ctx, c, in, b)
	binding, err := c.VisitorBinding(ctx, in)
	if isHiddenBinding(binding, err) {
		return
	}
	if err != nil {
		b.States = append(b.States, CapabilityState{ID: c.ID(), Enabled: false})
		return
	}
	accumActiveBinding(ctx, binding, c.ID(), b)
}

// appendPromptPart —— cap 的 system-prompt fragment id(非空才进),与 binding 无关
// (跟 VisitorPromptPartIDs 同源,不拨号)。
func appendPromptPart(
	ctx context.Context, c Capability, in *AssembleInput, b *VisitorBundle,
) {
	if id := c.SystemPromptFragmentID(ctx, in); id != "" {
		b.PromptPartIDs = append(b.PromptPartIDs, id)
	}
}

// isHiddenBinding —— ErrHidden 或干净的 nil binding = 该 cap 完全不暴露
// (跟 visitorStateFor 的隐藏判定一致)。
func isHiddenBinding(b *Binding, err error) bool {
	return errors.Is(err, ErrHidden) || (b == nil && err == nil)
}

// accumActiveBinding —— active binding 同时折出 state + tool specs,末了 Close。
func accumActiveBinding(
	ctx context.Context, binding *Binding, capID string, b *VisitorBundle,
) {
	state := binding.State
	if state.ID == "" {
		state.ID = capID
	}
	b.States = append(b.States, state)
	for i := range binding.Tools {
		b.ToolSpecs = append(b.ToolSpecs, toolToVisitorSpec(ctx, &binding.Tools[i]))
	}
	if binding.Close != nil {
		binding.Close()
	}
}
