// Package stats —— Monitor 观测面的领域值对象:活动流、语料增长、链接图节点、后台任务。
// 都是从现有行派生的只读快照(不建独立事件表),归一给 admin 的 Monitor / TopBar 用。
// 自成一个领域模块(#135 package-by-domain),不再挤在 domain god-package 里。
package stats

import "time"

// ActivityEvent —— 一条派生的活动事件（ActivityTicker）。每条一个 {kind, at, label}。
type ActivityEvent struct {
	At    time.Time
	Kind  string // 'visitor' | 'ingest'
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
