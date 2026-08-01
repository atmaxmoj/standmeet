// optional.go —— 入参里"没提到"和"显式设成空"是两件事的那种字段。
//
// 起因是配额:同一个 op,面板每次把所有字段都发出来、null 意思是"不限";MCP 那边省略的
// 字段意思是"别动这个"。JSON 本来就分得清"字段没出现"和"字段是 null",Go 的 *T 分不清
// —— 于是以前两个面各写各的(面板盲写、MCP 先读回来合并),同一件事两套规则,而盲写那条
// 会把没发的那个字段悄悄清掉。
//
// 放在这里跟 Op / RequireArgs 一起:声明操作的那个包就是解参的那个包,域拿它不需要
// 认识路由。

package facadeparity

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

// OptionalString / OptionalBool / OptionalStrings —— 同一件事,给另外三种字段。
// 底下是整行覆写的 SQL(UPDATE ... SET / upsert)时,"没提到"必须读回原值,否则
// 少发一个字段就等于把它清空 —— seo 的 site_title 就是这么被 MCP 那条路径洗掉的。
type OptionalString struct {
	Value string
	Set   bool
}

// UnmarshalJSON —— 出现即 Set;null 当空串(这类字段没有"空"和"无"的区别)。
func (o *OptionalString) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = ""
		return nil
	}
	if err := json.Unmarshal(b, &o.Value); err != nil {
		return BadInput("value must be a string or null")
	}
	return nil
}

// Or —— 没提到就用 current 顶上。
func (o *OptionalString) Or(current string) string {
	if o.Set {
		return o.Value
	}
	return current
}

// OptionalBool —— 三态开关。
type OptionalBool struct {
	Value bool
	Set   bool
}

// UnmarshalJSON —— 出现即 Set;null 当 false。
func (o *OptionalBool) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = false
		return nil
	}
	if err := json.Unmarshal(b, &o.Value); err != nil {
		return BadInput("value must be true, false or null")
	}
	return nil
}

// Or —— 没提到就用 current 顶上。
func (o *OptionalBool) Or(current bool) bool {
	if o.Set {
		return o.Value
	}
	return current
}

// OptionalStrings —— 三态列表。null 和 [] 都是"清空",跟"没提到"分得开。
type OptionalStrings struct {
	Value []string
	Set   bool
}

// UnmarshalJSON —— 出现即 Set;null 当空列表。
func (o *OptionalStrings) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = []string{}
		return nil
	}
	if err := json.Unmarshal(b, &o.Value); err != nil {
		return BadInput("value must be an array of strings or null")
	}
	return nil
}

// Or —— 没提到就用 current 顶上。
func (o *OptionalStrings) Or(current []string) []string {
	if o.Set {
		return o.Value
	}
	return current
}
