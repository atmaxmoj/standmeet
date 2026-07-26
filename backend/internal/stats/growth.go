package stats

// CorpusDayCount —— 某一天的 corpus 新增条数（raw+wiki+output 合计）。
type CorpusDayCount struct {
	Day   string // YYYY-MM-DD (UTC)
	Count int
}

// CorpusTierCounts —— 各 genre 当前总量（真 COUNT(*)，非分页页长）+ raw 待处理数。
// 供 dashboard KPI / sidebar 徽章 / genre 头计数用 —— 这些绝不能数「已加载的第一页」。
type CorpusTierCounts struct {
	Raw            int
	Wiki           int
	Output         int
	Writing        int
	RawUnprocessed int // genre='raw' 且未 promote、未 archive —— 对齐 sidebar 徽章语义
}

// CorpusGrowth —— SystemPulse 数据：14 天新增序列 + 7 天增量 + 分层总量。
type CorpusGrowth struct {
	Series  []CorpusDayCount
	ByTier  CorpusTierCounts
	Total   int
	Delta7d int
}
