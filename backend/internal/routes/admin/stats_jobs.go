// stats_jobs.go —— GET /api/admin/stats/jobs（SystemSection background-jobs 表）。自成 domain。

package admin

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/stats"
)

// JobsProvider —— 计划任务登记表（jobregistry.Registry 实现）。进程内、非 owner-scoped。
type JobsProvider interface {
	ScheduledJobs() []stats.ScheduledJob
}

type jobResp struct {
	LastRun    *string `json:"last_run"`
	Name       string  `json:"name"`
	Schedule   string  `json:"schedule"`
	LastStatus string  `json:"last_status"`
}

type jobsResp struct {
	Jobs []jobResp `json:"jobs"`
}

func (h *Handlers) getScheduledJobs() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(toJobsResp(h.Jobs.ScheduledJobs())); eerr != nil {
			logEncodeErr(h.Log, "encode scheduled jobs", eerr)
		}
	}
}

func toJobsResp(jobs []stats.ScheduledJob) jobsResp {
	out := make([]jobResp, 0, len(jobs))
	for i := range jobs {
		out = append(out, jobResp{
			LastRun:    formatLastRun(jobs[i].LastRun),
			Name:       jobs[i].Name,
			Schedule:   jobs[i].Schedule,
			LastStatus: jobs[i].LastStatus,
		})
	}
	return jobsResp{Jobs: out}
}

func formatLastRun(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}
