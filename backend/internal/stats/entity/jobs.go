package entity

import "time"

// ScheduledJob — a registered scheduled job and its most recent run status.
// Only registers cron jobs that **actually run** (currently just one:
// sandbox workspace sweep #148).
type ScheduledJob struct {
	LastRun    *time.Time // nil = has not run yet
	Name       string
	Schedule   string
	LastStatus string // 'scheduled' | 'ok' | 'error'
}
