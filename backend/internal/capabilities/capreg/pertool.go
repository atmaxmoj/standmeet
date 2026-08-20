// pertool.go —— **动作级**的那一层闸：能力过了闸，不代表它的每一个动作都做得了。
//
// 为什么要有这一层（F-B-8 ⭐⭐）：`Requires` 是能力级的，只答「连没连」。owner 只授了
// `calendar.readonly` 时，日历连接是好的、列时段是好的，**只有写永远 403** ——
// 而产品照旧把「订会」摆在访客面前，还告诉他「过一会儿再问」（那句话永远不会成真）。
//
// 为什么不能把要求提到能力级：那会**连列时段一起藏掉**，而它在只读授权下本来是好的。
// 为了修「提供了做不到的动作」而拿掉一个「做得到的动作」，不是修复。产品在邮件那边
// 早就按动作办：确认邮件那一块不渲染，预约本身照旧在。

package capreg

import "context"

// RequiresPerTool —— 可选接口：这个能力的**某几个工具**各自还额外要什么依赖。
//
// 返回的表只放**点了名的那几个**；不在表里 = 没有额外要求（那是绝大多数）。
type RequiresPerTool interface {
	ToolRequires() map[string][]string
}

// dropUnperformableTools —— 按工具各自声明的依赖再筛一遍：做不了的那一个不出现，
// 做得了的照旧在。没声明的一律留着。
func (r *Registry) dropUnperformableTools(
	ctx context.Context, c Capability, in *AssembleInput, b *Binding,
) {
	reqs := perToolRequires(c, in)
	if len(reqs) == 0 {
		return
	}
	kept := make([]BindingTool, 0, len(b.Tools))
	for i := range b.Tools {
		if r.toolPerformable(ctx, c, in, reqs[b.Tools[i].Name]) {
			kept = append(kept, b.Tools[i])
		}
	}
	b.Tools = kept
}

// perToolRequires —— 这个能力有没有动作级声明，以及这一场有没有 owner 上下文可判。
// 任一不成立 → 空表 → 一个都不筛。
func perToolRequires(c Capability, in *AssembleInput) map[string][]string {
	pr, ok := c.(RequiresPerTool)
	if !ok || in == nil || in.OwnerID == "" {
		return map[string][]string{}
	}
	return pr.ToolRequires()
}

// toolPerformable —— 这一个工具点名的依赖都满足吗。没点名 → 留着。
// 解析出错按**做不了**处理（fail-closed，跟能力级那一层同一条纪律）：
// 说不清能不能做的时候，不把它摆给访客。
func (r *Registry) toolPerformable(
	ctx context.Context, c Capability, in *AssembleInput, names []string,
) bool {
	if len(names) == 0 {
		return true
	}
	return r.requiredDepsConnected(ctx, c, in, names)
}
