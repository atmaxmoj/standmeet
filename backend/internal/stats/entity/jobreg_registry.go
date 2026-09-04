// jobreg_registry.go — in-process registry for background scheduled jobs
// (Monitor/stats background-jobs).
// A cron job calls Register on startup and Report(status) after each run;
// admin /stats/jobs reads the snapshot.

package entity

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
	every      time.Duration
}

// JobRegistry — a thread-safe registry of scheduled jobs.
type JobRegistry struct {
	jobs map[string]*jobState
	mu   sync.Mutex
}

// NewJobRegistry builds an empty registry.
func NewJobRegistry() *JobRegistry { return &JobRegistry{jobs: make(map[string]*jobState)} }

// Register — declares a scheduled job (idempotent; before its first run,
// last_run=nil and status='scheduled'). `every` is the real interval, kept so the
// panel can tell a job that ran on time from one that's long overdue.
func (r *JobRegistry) Register(name, schedule string, every time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.jobs[name]; !ok {
		r.jobs[name] = &jobState{
			name: name, schedule: schedule, every: every, lastStatus: "scheduled",
		}
	}
}

// Report — records the result of one run, stamping last_run with the current
// time. An unregistered name is ignored.
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

// ScheduledJobs — a snapshot of all current jobs, sorted by name.
func (r *JobRegistry) ScheduledJobs() []ScheduledJob {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]ScheduledJob, 0, len(r.jobs))
	for _, j := range r.jobs {
		out = append(out, ScheduledJob{
			LastRun:    j.lastRun,
			Every:      j.every,
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
