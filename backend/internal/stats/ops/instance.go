// Package ops —— what the stats domain exposes externally: this instance's own observability
// surface. All read-only.
//
//	status           version / uptime / dependency health / memory & disk load
//	inference_usage  last 7 days of LLM usage
//	corpus_growth    corpus growth (14-day series + per-tier totals)
//	corpus_graph     corpus link graph (nodes + link degree)
//	activity         recent event stream
//	jobs             background scheduled jobs
//
// Migration patched two spots where the surfaces didn't line up: corpus_growth's by_tier panel
// gives 5 numbers, MCP gives only 3; corpus_graph **doesn't exist on MCP at all**, and it isn't
// even a row in that handwritten parity table — a route with neither an MCP twin nor a
// registered entry is invisible to the ratchet. Both surfaces still owe fixes for it.
package ops

import (
	"context"
	"encoding/json"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/stats/entity"
	"github.com/atmaxmoj/standmeet/internal/stats/repo"
)

const (
	// graphDefaultLimit —— how many nodes the corpus graph takes by default.
	graphDefaultLimit = 60
	// activityFeedLimit —— how many entries the activity feed returns per call.
	activityFeedLimit = 20
	// dayFormat —— usage is grouped by day; this is the date format used for that.
	dayFormat = "2006-01-02"
)

var noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// SystemInfoSource —— where the process's and host's runtime snapshot comes from. Version,
// goroutine count, and disk usage are things the **process itself** knows, not this domain's
// own data, so they arrive through a narrow port the composition root injects.
// The shape reuses the domain's existing entity.SystemInfo instead of inventing a second one.
type SystemInfoSource interface {
	SystemInfo(ctx context.Context) entity.SystemInfo
}

// InstanceDeps —— the five sources this group needs.
type InstanceDeps struct {
	System   SystemInfoSource
	Usage    *repo.InferenceUsageRepo
	Growth   *repo.GrowthRepo
	Activity *repo.ActivityRepo
	Jobs     *entity.JobRegistry
}

// Instance —— six read-only observation ports.
func Instance(deps InstanceDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "instance.status",
			Description: "Instance health snapshot: version, uptime, dependency health pings " +
				"(db/redis/storage), Go runtime plus host memory, disk and load.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      instanceStatus(deps.System),
		},
		{
			ID: "instance.inference_usage",
			Description: "Last 7 days of LLM inference usage, one row per day×model " +
				"(calls / input tokens / output tokens) plus a grand total.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      inferenceUsage(deps.Usage),
		},
		{
			ID: "instance.corpus_growth",
			Description: "Corpus growth: 14-day new-entry series, 7-day delta, and current " +
				"per-tier totals (raw / wiki / output / writing / unprocessed raw).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      corpusGrowth(deps.Growth),
		},
		{
			ID: "instance.corpus_graph",
			Description: "Corpus link constellation: notes with their link degree — how many " +
				"note_refs touch them, both directions. Hubs have the highest degree.",
			InputSchema: graphSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      corpusGraph(deps.Activity),
		},
		{
			ID: "instance.activity",
			Description: "Recent activity events (visitor / ingest / booking), newest first, " +
				"each a {kind, at, label}.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      recentActivity(deps.Activity),
		},
		{
			ID: "instance.jobs",
			Description: "Registered background jobs with each one's last-run time and status " +
				"(scheduled / ok / error).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      scheduledJobs(deps.Jobs),
		},
	}
}

var graphSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"limit":{"type":"integer","description":"Max nodes (default 60)."}}
}`)

type healthOut struct {
	Name   string `json:"name"`
	Detail string `json:"detail"`
	OK     bool   `json:"ok"`
}

type statusOut struct {
	Version       string      `json:"version"`
	Health        []healthOut `json:"health"`
	UptimeSeconds int64       `json:"uptime_seconds"`
	MemAllocMB    int64       `json:"mem_alloc_mb"`
	DiskTotalMB   int64       `json:"disk_total_mb"`
	DiskFreeMB    int64       `json:"disk_free_mb"`
	MemTotalMB    int64       `json:"mem_total_mb"`
	MemUsedMB     int64       `json:"mem_used_mb"`
	LoadAvg1      float64     `json:"load_avg_1"`
	Goroutines    int         `json:"goroutines"`
	NumCPU        int         `json:"num_cpu"`
}

func instanceStatus(system SystemInfoSource) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		info := system.SystemInfo(ctx)
		health := make([]healthOut, 0, len(info.Health))
		for i := range info.Health {
			health = append(health, healthOut{
				Name: info.Health[i].Name, Detail: info.Health[i].Detail, OK: info.Health[i].OK,
			})
		}
		return json.Marshal(statusOut{
			Version: info.Version, UptimeSeconds: info.UptimeSeconds,
			Goroutines: info.Goroutines, MemAllocMB: info.MemAllocMB,
			DiskTotalMB: info.DiskTotalMB, DiskFreeMB: info.DiskFreeMB,
			MemTotalMB: info.MemTotalMB, MemUsedMB: info.MemUsedMB,
			LoadAvg1: info.LoadAvg1, NumCPU: info.NumCPU, Health: health,
		})
	}
}

// formatOptionalTime —— nil stays null (the frontend shows "never run yet" based on that).
func formatOptionalTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}
