// registry_tool_dispatch.go —— 单个 tool 调用那条路的装配。
//
// 访客点一次卡片按钮 → POST /sessions/{id}/tools/{name}。这条路**只用得上一个
// tool**,而 AssembleVisitor 会把每个能力都实例化一遍 —— 外置能力实例化 = 起一个
// bwrap 沙箱。加上执行完还要回一份 CapabilityState(那一趟又逐个 VisitorBinding),
// 一次点击实测拨了 **2N** 次沙箱,N 是装上的外置能力数。空闲时每次约 1s,机器压满
// 时整段见过 19 秒:访客盯着一个没反应的按钮,以为没发出去,再点一次。
//
// 这里收成两件事,各自去掉一个 N:
//
//   - AssembleVisitorForTool —— 只拨**可能提供这个 tool** 的能力。谁提供什么
//     tool 是 server 级静态信息,首拨之后能力自己就知道(ToolNameKnower);还不知道
//     的照拨(冷启第一次),拨到了就不再往下拨。
//   - StateReporter —— 报 state 不需要一个会话。能力实现它,就不必为了拿
//     {id,enabled,quota} 而起一个沙箱再关掉。
//
// 语义上要守住的是 **闸**:role 授权、connector 未连、quota 耗尽这些判定必须跟拨号
// 那条路完全一致(quota 用完 → 按钮当场置灰,靠的就是执行完这一趟 state)。变的只有
// 一处:沙箱起不来时,原来该能力会从 state 列表里**消失**(按钮无故不见),现在它照常
// 在列表里、点下去得到一条工具失败的回执。

package capreg

import (
	"context"
	"slices"
)

// ToolNameKnower —— 能力不拨号就说得出自己暴露哪些 tool name。
//
// 第二个返回值是"知不知道",不是"有没有":还没拨过的能力答 false,调度那侧照拨。
// **不能拿空切片表示不知道** —— 那样一个真的零工具的能力和一个还没拨过的能力就分不开了。
// 名字必须跟 Binding.Tools 里的**完全一致**(带前缀的带前缀),否则这条能力会被永远跳过。
type ToolNameKnower interface {
	KnownToolNames() ([]string, bool)
}

// StateReporter —— 能力不拨号就报得出自己的 CapabilityState。返 (state, false) =
// 本 session 完全不暴露(跟 ErrHidden 一样不进 map)。闸的判定必须跟 VisitorBinding
// 用同一套,否则 state 会跟实际暴露的 tool 对不上。
type StateReporter interface {
	VisitorStateOnly(ctx context.Context, in *AssembleInput) (CapabilityState, bool)
}

// reportedState —— 走 StateReporter 那条路的 state,补上 title(dock 按钮 label
// 走 Titled,跟拨号那条路一致)。
func reportedState(
	ctx context.Context, reporter StateReporter, c Capability, in *AssembleInput,
) (CapabilityState, bool) {
	st, exposed := reporter.VisitorStateOnly(ctx, in)
	if !exposed {
		return CapabilityState{}, false
	}
	if st.ID == "" {
		st.ID = c.ID()
	}
	setCapTitle(&st, c)
	return st, true
}

// AssembleVisitorForTool —— 装配到**够跑 tool 为止**。
//
// 返回的 binding 里可能夹着几条不含该 tool 的(还没缓存过 tool 名的能力只能拨了才
// 知道),caller 照旧对整个切片 Close。找到之后不再往下拨。
// 一个都没找到时返回已拨的那些,caller 据此回 capability_not_enabled。
func (r *Registry) AssembleVisitorForTool(
	ctx context.Context, in *AssembleInput, tool string,
) []*Binding {
	caps := r.enabledCaps(ctx, in)
	out := make([]*Binding, 0, 1)
	for _, c := range caps {
		b := dialIfMayServe(ctx, c, in, tool)
		if b == nil {
			continue
		}
		out = append(out, b)
		if bindingHasTool(b, tool) {
			break
		}
	}
	return out
}

// dialIfMayServe —— 可能提供该 tool 就实例化,返 nil = 跳过(不可能提供,或者拨不起来)。
func dialIfMayServe(
	ctx context.Context, c Capability, in *AssembleInput, tool string,
) *Binding {
	if !mayServeTool(c, tool) {
		return nil
	}
	b, err := c.VisitorBinding(ctx, in)
	if err != nil {
		return nil
	}
	return b
}

// mayServeTool —— 这个能力有没有可能提供该 tool。说不出自己 tool 名的(没实现
// ToolNameKnower,或还没拨过)一律算"有可能" —— 宁可白拨,不能漏掉。
func mayServeTool(c Capability, tool string) bool {
	knower, ok := c.(ToolNameKnower)
	if !ok {
		return true
	}
	names, known := knower.KnownToolNames()
	if !known {
		return true
	}
	return slices.Contains(names, tool)
}

func bindingHasTool(b *Binding, tool string) bool {
	for i := range b.Tools {
		if b.Tools[i].Name == tool {
			return true
		}
	}
	return false
}
