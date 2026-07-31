// res_instance_usage_types.go —— instance 观测面:**花了多少 / 发生了什么**
// (LLM 用量、最近事件流、后台任务)。

package dispatcher

import "time"

// InferenceUsage —— 近 7 天用量,按 天×模型 一行,外加合计。
type InferenceUsage struct {
	Rows  []UsageRow
	Total UsageTotal
}

// UsageRow —— 某天某模型的调用与 token 数。
type UsageRow struct {
	Date         string
	Model        string
	Calls        int64
	InputTokens  int64
	OutputTokens int64
}

// UsageTotal —— 全部行的合计。
type UsageTotal struct {
	Calls        int64
	InputTokens  int64
	OutputTokens int64
}

// ActivityEvent —— 一条最近事件(访客 / 摄入 / 预约)。
type ActivityEvent struct {
	At    time.Time
	Kind  string
	Label string
}

// ScheduledJob —— 一个后台计划任务和它上次跑的结果。LastRun 为 nil = 还没跑过。
type ScheduledJob struct {
	LastRun    *time.Time
	Name       string
	Schedule   string
	LastStatus string
}
