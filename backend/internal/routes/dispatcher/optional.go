// optional.go —— 入参里"没提到"和"显式设成空"是两件事的那种字段。
//
// 起因是配额:同一个 op,面板每次把所有字段都发出来、null 意思是"不限";MCP 那边省略的
// 字段意思是"别动这个"。JSON 本来就分得清"字段没出现"和"字段是 null",Go 的 *T 分不清
// —— 于是以前两个面各写各的(面板盲写、MCP 先读回来合并),同一件事两套规则,而盲写那条
// 会把没发的那个字段悄悄清掉。

package dispatcher

import "encoding/json"

// OptionalInt32 —— 三态:没提到(Set=false,保持原值) / 显式 null(Set=true、Value=nil,
// 清成"不限") / 数字(设值)。
type OptionalInt32 struct {
	Value *int32
	Set   bool
}

// UnmarshalJSON —— 字段出现过就 Set=true(值可能是 null);没出现过这个方法根本不会被调用,
// 零值 Set=false 就是"没提到"。
func (o *OptionalInt32) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = nil
		return nil
	}
	var v int32
	if err := json.Unmarshal(b, &v); err != nil {
		return BadInput("value must be a number or null")
	}
	o.Value = &v
	return nil
}

// Or —— 没提到就用 current 顶上。
func (o *OptionalInt32) Or(current *int32) *int32 {
	if o.Set {
		return o.Value
	}
	return current
}
