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
