// stats_growth.go —— Monitor 观测面：corpus 增长脉搏（SystemPulse）。自成 domain，
// 跟 SystemInfo / activity / jobs 各管各的，不共享 stats god-type。

package domain

// CorpusDayCount —— 某一天的 corpus 新增条数（raw+wiki+output 合计）。
type CorpusDayCount struct {
	Day   string // YYYY-MM-DD (UTC)
	Count int
}

// CorpusTierCounts —— 三层当前总量。
type CorpusTierCounts struct {
	Raw    int
	Wiki   int
	Output int
}

// CorpusGrowth —— SystemPulse 数据：14 天新增序列 + 7 天增量 + 分层总量。
type CorpusGrowth struct {
	Series  []CorpusDayCount
	ByTier  CorpusTierCounts
	Total   int
	Delta7d int
}
