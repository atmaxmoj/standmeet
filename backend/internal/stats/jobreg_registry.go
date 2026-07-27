// jobreg_registry.go —— 进程内后台计划任务登记表(Monitor/stats background-jobs)。
// cron 启动时 Register,每次跑完 Report(status);admin /stats/jobs 读快照。

package stats

import (
	"slices"
	"strings"
	"sync"
	"time"
)

type jobState struct {
	lastRun    *time.Time
	name       string
	schedule   string
	lastStatus string
}

// JobRegistry —— 线程安全的计划任务登记表。
type JobRegistry struct {
	jobs map[string]*jobState
	mu   sync.Mutex
}

// NewJobRegistry 构造一个空登记表。
func NewJobRegistry() *JobRegistry { return &JobRegistry{jobs: make(map[string]*jobState)} }

// Register —— 声明一个计划任务（幂等；未跑过时 last_run=nil、status='scheduled'）。
func (r *JobRegistry) Register(name, schedule string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.jobs[name]; !ok {
		r.jobs[name] = &jobState{name: name, schedule: schedule, lastStatus: "scheduled"}
	}
}

// Report —— 记录一次运行结果，戳当前时间为 last_run。未注册的名字忽略。
func (r *JobRegistry) Report(name, status string) {
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
func (r *JobRegistry) ScheduledJobs() []ScheduledJob {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]ScheduledJob, 0, len(r.jobs))
	for _, j := range r.jobs {
		out = append(out, ScheduledJob{
			LastRun:    j.lastRun,
			Name:       j.name,
			Schedule:   j.schedule,
			LastStatus: j.lastStatus,
		})
	}
	slices.SortFunc(out, func(a, b ScheduledJob) int {
		return strings.Compare(a.Name, b.Name)
	})
	return out
}
