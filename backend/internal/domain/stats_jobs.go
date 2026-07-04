// stats_jobs.go —— Monitor 观测面：后台计划任务（SystemSection 的 background-jobs 表）。
// 自成 domain。只登记**真正在跑**的 cron —— 目前唯一一个:沙箱工作区 sweep（#148）。

package domain

import "time"

// ScheduledJob —— 一个已注册的计划任务及其最近一次运行状态。
type ScheduledJob struct {
	LastRun    *time.Time // nil = 尚未跑过
	Name       string
	Schedule   string
	LastStatus string // 'scheduled' | 'ok' | 'error'
}
