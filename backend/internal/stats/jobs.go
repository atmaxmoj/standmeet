package stats

import "time"

// ScheduledJob —— 一个已注册的计划任务及其最近一次运行状态。只登记**真正在跑**的 cron
// （目前唯一一个:沙箱工作区 sweep #148）。
type ScheduledJob struct {
	LastRun    *time.Time // nil = 尚未跑过
	Name       string
	Schedule   string
	LastStatus string // 'scheduled' | 'ok' | 'error'
}
