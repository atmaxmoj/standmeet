// Package jobregistry —— 进程内的后台计划任务登记表（Monitor/SystemSection background-jobs）。
// 真 cron 在启动时 Register，每次跑完 Report(status)。admin /stats/jobs 读快照。只登记真正在
// 跑的任务 —— 不编造 sitemap/backup 之类不存在的 job（那正是这块占位当初要避免的假象）。
package jobregistry

import (
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/stats"
)

type jobState struct {
	lastRun    *time.Time
	name       string
	schedule   string
	lastStatus string
}

// Registry —— 线程安全的计划任务登记表。
type Registry struct {
	jobs map[string]*jobState
	mu   sync.Mutex
}

// New 构造一个空登记表。
func New() *Registry { return &Registry{jobs: make(map[string]*jobState)} }

// Register —— 声明一个计划任务（幂等；未跑过时 last_run=nil、status='scheduled'）。
func (r *Registry) Register(name, schedule string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.jobs[name]; !ok {
		r.jobs[name] = &jobState{name: name, schedule: schedule, lastStatus: "scheduled"}
	}
}

// Report —— 记录一次运行结果，戳当前时间为 last_run。未注册的名字忽略。
func (r *Registry) Report(name, status string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	j, ok := r.jobs[name]
	if !ok {
		return
	}
	now := time.Now().UTC()
	j.lastRun = &now
	j.lastStatus = status
}

// ScheduledJobs —— 当前所有任务快照，按名字排序。
func (r *Registry) ScheduledJobs() []stats.ScheduledJob {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]stats.ScheduledJob, 0, len(r.jobs))
	for _, j := range r.jobs {
		out = append(out, stats.ScheduledJob{
			LastRun:    j.lastRun,
			Name:       j.name,
			Schedule:   j.schedule,
			LastStatus: j.lastStatus,
		})
	}
	slices.SortFunc(out, func(a, b stats.ScheduledJob) int {
		return strings.Compare(a.Name, b.Name)
	})
	return out
}
