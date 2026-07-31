// res_instance_corpus_types.go —— instance 观测面:**语料**的形状(增长曲线 + 链接图)。

package dispatcher

// CorpusGrowth —— 语料增长:14 天新增曲线、7 天差值、各层当前总数。
type CorpusGrowth struct {
	Series  []DayCount
	ByTier  TierCounts
	Total   int
	Delta7d int
}

// DayCount —— 某天新增了多少条。
type DayCount struct {
	Day   string
	Count int
}

// TierCounts —— 各层当前总数。writing 和 raw_unprocessed 也在:
// 迁移前 MCP 面只给前三个,owner 从 Claude Code 看不到这两个数。
type TierCounts struct {
	Raw            int
	Wiki           int
	Output         int
	Writing        int
	RawUnprocessed int
}

// GraphNode —— 语料链接图的一个节点;degree 是 note_refs 双向触到它的边数,越大越是枢纽。
type GraphNode struct {
	ID     string
	Title  string
	Genre  string
	Degree int
}
