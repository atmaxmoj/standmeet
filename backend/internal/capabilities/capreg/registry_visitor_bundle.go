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
	"sync"
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
//
// **每个 cap 并发实例化。** 这一步躲不开"全部都拨"(会话要拿到全部 tool spec),但没有理由
// 一个一个拨:每个外置能力实例化 = 起一个 bwrap 沙箱(冷启约 1 秒),串行就是 N 秒起步。
// 实测负载下 `/api/v1/sessions` 要 13.9 秒,而访客侧 15 秒放弃 —— 表现成"会话偶尔打不开"。
// (#17 收的是**单次工具调用**那条:只拨提供该 tool 的那一个。这条要全部,能省的只有等待方式。)
//
// **顺序仍然是注册顺序**:每个 cap 先各折进自己那一格,再按格子顺序拼起来。前端的能力列表、
// prompt part 的拼接顺序都靠它,并发化最容易弄丢的就是这个 —— 所以它有单独一条测试。
//
// 并发度不设上限:能力数是注册期就定死的一小撮(个位数),不是随请求增长的量。
func (r *Registry) AssembleVisitorBundle(
	ctx context.Context, in *AssembleInput,
) VisitorBundle {
	caps := r.enabledCaps(ctx, in)
	slots := make([]VisitorBundle, len(caps))
	var wg sync.WaitGroup
	for i, c := range caps {
		wg.Go(func() { slots[i] = capBundleSlot(ctx, c, in) })
	}
	wg.Wait()
	return mergeVisitorSlots(slots, len(caps))
}

// capBundleSlot —— 一个 cap 自己那一格(只装它自己贡献的东西)。并发写各自的格子,
// 不碰共享切片 —— 共享 append 既要锁,又会把顺序变成"谁先回来"。
func capBundleSlot(ctx context.Context, c Capability, in *AssembleInput) VisitorBundle {
	slot := VisitorBundle{
		States:        make([]CapabilityState, 0, 1),
		ToolSpecs:     make([]VisitorToolSpec, 0),
		PromptPartIDs: make([]string, 0, 1),
	}
	accumVisitorCap(ctx, c, in, &slot)
	return slot
}

// mergeVisitorSlots —— 按注册顺序拼回一份 bundle。header 永远是第一个 prompt part。
func mergeVisitorSlots(slots []VisitorBundle, n int) VisitorBundle {
	b := VisitorBundle{
		States:        make([]CapabilityState, 0, n),
		ToolSpecs:     make([]VisitorToolSpec, 0),
		PromptPartIDs: make([]string, 0, 1+n),
	}
	b.PromptPartIDs = append(b.PromptPartIDs, VisitorHeaderFragmentID)
	for i := range slots {
		b.States = append(b.States, slots[i].States...)
		b.ToolSpecs = append(b.ToolSpecs, slots[i].ToolSpecs...)
		b.PromptPartIDs = append(b.PromptPartIDs, slots[i].PromptPartIDs...)
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
		st := CapabilityState{ID: c.ID(), Enabled: false}
		setCapTitle(&st, c) // disabled 的也带 title：dock 按钮置灰时仍要 label
		b.States = append(b.States, st)
		return
	}
	accumActiveBinding(ctx, binding, c, b)
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
	ctx context.Context, binding *Binding, c Capability, b *VisitorBundle,
) {
	state := binding.State
	if state.ID == "" {
		state.ID = c.ID()
	}
	setCapTitle(&state, c) // dock 按钮 label 透传 MCP title（无 id 兜底）
	b.States = append(b.States, state)
	for i := range binding.Tools {
		b.ToolSpecs = append(b.ToolSpecs, toolToVisitorSpec(ctx, &binding.Tools[i]))
	}
	if binding.Close != nil {
		binding.Close()
	}
}
