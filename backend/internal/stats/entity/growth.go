package entity

// CorpusDayCount — new corpus entries on a given day (raw+wiki+output combined).
type CorpusDayCount struct {
	Day   string // YYYY-MM-DD (UTC)
	Count int
}

// CorpusTierCounts — current total per genre (a real COUNT(*), not a page
// length) + count of unprocessed raw. Used by dashboard KPIs / sidebar
// badges / genre header counts — these must never count "the first page
// already loaded".
type CorpusTierCounts struct {
	Raw            int
	Wiki           int
	Output         int
	Writing        int
	RawUnprocessed int // raw genre, not yet promoted/archived — matches badge semantics
}

// CorpusGrowth — SystemPulse data: 14-day new-entry series + 7-day delta + per-tier totals.
type CorpusGrowth struct {
	Series  []CorpusDayCount
	ByTier  CorpusTierCounts
	Total   int
	Delta7d int
}
