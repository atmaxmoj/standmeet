// quota.go —— 一个能力的 per-主体用量上限,**声明成数据**。
//
// "这张码最多能约两次" 由三个事实构成:上限在哪(主体上的哪个配置字段)、用量怎么数(能力
// 自己存储里的哪个 collection)、怎么认出属于这个主体(那些文档里的哪个字段)。三个都是这个
// 能力自己的知识,所以由它自己说。
//
// **主体不只有码**:访客拿着一张码进来,别人的程序拿着一把对外 key 调进来 —— 两者都是"每个
// X 多少次"里的那个 X。这份声明只说字段名,不说是哪一类主体。
//
// 宿主拿着这三句话就能通用地实现两件事,一份计数:
//
//   - 闸:数到上限 → 这次会话不暴露这个工具(隐藏,而不是让访客点了再报错)。
//   - 余量:把"还剩几次"填进 capability_state,前端照着显示。
//
// 之前这两个钩子在组装根手写,里面明明白白写着 "bookings"、"code_id"、"max_bookings" ——
// 内核不认识 booking,组装根却认识。而且写过一次教训:#135 外置 booker 时两个钩子一起被
// 摘掉,后来只补回了闸,余量从此永远是 nil,而前端契约仍然承诺那个字段。两件事共用一份
// 声明,就不会再补回一半。

package mcpplugin

// QuotaDecl —— per-**主体**用量上限的声明。主体是一张码,也可能是一把对外 API key。
type QuotaDecl struct {
	// ConfigKey —— 上限值取自这个主体的配置里的哪个键(如 "max_bookings")。
	// 该键没设 / 设成 null / ≤ 0 → 不限。
	ConfigKey string
	// Collection —— 用量数的是本能力自己存储里的哪个 collection(如 "bookings")。
	Collection string
	// SubjectField —— 那些文档里哪个字段记着**主体**(如 "subject_id")。
	//
	// 这个字段以前叫 `CodeField`,值是 `"code_id"` —— 一个只认得码的名字。于是对外 API key
	// 那条路上写下的行没有可数的主体,配额一次都不数(F-B-11)。名字改成主体之后,"挂在谁身上"
	// 才真的是参数([[names-that-lie]])。
	SubjectField string
}

// Usable —— 这份声明能不能真的执行。三句话齐了才算数:缺一句宿主就数不出用量,
// 那时候"不闸"比"瞎闸"对。nil 接收者是合法的(大多数能力不闸用量)。
func (q *QuotaDecl) Usable() bool {
	return q != nil && q.ConfigKey != "" && q.Collection != "" && q.SubjectField != ""
}
