// stats_activity.go —— Monitor 观测面：近期活动流（ActivityTicker）。自成 domain。
// 从现有行派生（不建 events 表），每条一个 {kind, at, label}。

package domain

import "time"

// ActivityEvent —— 一条派生的活动事件。
type ActivityEvent struct {
	At    time.Time
	Kind  string // 'visitor' | 'ingest' | 'booking'
	Label string
}

// GraphNode —— 语料链接图的一个节点：一条 note + 它的链接度（note_refs 里触到它的边数,
// 双向）。degree 越大越是 hub。给 admin TopBar 的 constellation（越多链接越大的节点）用。
type GraphNode struct {
	ID     string
	Title  string
	Genre  string
	Degree int
}
