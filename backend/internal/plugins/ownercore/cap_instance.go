// cap_instance.go —— owner instance observability via Capability. Exposes the admin-only
// system/stats surface (system health, inference usage, corpus growth, recent activity, scheduled
// jobs) as owner-MCP read tools. owner-only; all five tools are argless reads that call a usecase
// and marshal the result. Deps are the five narrow provider interfaces the admin routes use.

package ownercore

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
)

const capInstanceBundle = "instance.bundle"

// argless read tools share this empty input schema.
const emptyObjectSchema = `{"type":"object","properties":{}}`

// ───── dep interfaces (mirror the admin route providers, one method each) ─────

// instanceSystemInfo —— system health/version/uptime/mem/disk snapshot (admin system.go).
type instanceSystemInfo interface {
	SystemInfo(ctx context.Context) domain.SystemInfo
}

// instanceUsage —— 7-day LLM usage by day×model (admin inference_usage.go).
type instanceUsage interface {
	Summarize7Day(ctx context.Context, ownerID string) ([]domain.InferenceUsageDay, error)
}

// instanceGrowth —— corpus growth series (admin stats_growth.go).
type instanceGrowth interface {
	CorpusGrowth(ctx context.Context, ownerID string) (domain.CorpusGrowth, error)
}

// instanceActivity —— recent activity events (admin stats_activity.go).
type instanceActivity interface {
	RecentActivity(ctx context.Context, ownerID string, limit int) ([]domain.ActivityEvent, error)
}

// instanceJobs —— registered scheduled background jobs (admin stats_jobs.go). Not owner-scoped.
type instanceJobs interface {
	ScheduledJobs() []domain.ScheduledJob
}

// InstanceDeps —— the five method-owning providers, each from a distinct concrete.
type InstanceDeps struct {
	System   instanceSystemInfo
	Usage    instanceUsage
	Growth   instanceGrowth
	Activity instanceActivity
	Jobs     instanceJobs
}

type instanceCapability struct {
	deps *InstanceDeps
	log  *slog.Logger
}

func newInstanceCapability(deps *InstanceDeps, log *slog.Logger) *instanceCapability {
	return &instanceCapability{deps: deps, log: log}
}

func (*instanceCapability) ID() string          { return capInstanceBundle }
func (*instanceCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }

func (*instanceCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*instanceCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*instanceCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *instanceCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.statusBinding(), c.inferenceUsageBinding(), c.corpusGrowthBinding(),
		c.activityBinding(), c.jobsBinding(),
	}
}

// ───── instance.status ──────────────────────────────────────────

func (c *instanceCapability) statusBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "instance.status",
		Description: "Instance health snapshot: version, uptime, dependency health pings " +
			"(db/redis/storage), Go runtime + host memory/disk/load.",
		InputSchema: json.RawMessage(emptyObjectSchema),
		Handler:     c.handleStatus,
	}
}

type healthResp struct {
	Name   string `json:"name"`
	Detail string `json:"detail"`
	OK     bool   `json:"ok"`
}

type statusResp struct {
	Version       string       `json:"version"`
	Health        []healthResp `json:"health"`
	UptimeSeconds int64        `json:"uptime_seconds"`
	MemAllocMB    int64        `json:"mem_alloc_mb"`
	DiskTotalMB   int64        `json:"disk_total_mb"`
	DiskFreeMB    int64        `json:"disk_free_mb"`
	MemTotalMB    int64        `json:"mem_total_mb"`
	MemUsedMB     int64        `json:"mem_used_mb"`
	LoadAvg1      float64      `json:"load_avg_1"`
	Goroutines    int          `json:"goroutines"`
	NumCPU        int          `json:"num_cpu"`
}

func (c *instanceCapability) handleStatus(
	ctx context.Context, _ string, _ json.RawMessage,
) capreg.MCPResult {
	info := c.deps.System.SystemInfo(ctx)
	health := make([]healthResp, 0, len(info.Health))
	for i := range info.Health {
		health = append(health, healthResp{
			Name: info.Health[i].Name, Detail: info.Health[i].Detail, OK: info.Health[i].OK,
		})
	}
	return mcputil.MarshalResult(c.log, "instance.status", statusResp{
		Version: info.Version, UptimeSeconds: info.UptimeSeconds, Goroutines: info.Goroutines,
		MemAllocMB: info.MemAllocMB, DiskTotalMB: info.DiskTotalMB, DiskFreeMB: info.DiskFreeMB,
		MemTotalMB: info.MemTotalMB, MemUsedMB: info.MemUsedMB, LoadAvg1: info.LoadAvg1,
		NumCPU: info.NumCPU, Health: health,
	})
}

// ───── instance.inference_usage ─────────────────────────────────

func (c *instanceCapability) inferenceUsageBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "instance.inference_usage",
		Description: "Last 7 days of LLM inference usage, one row per day×model " +
			"(calls / input tokens / output tokens) plus a grand total.",
		InputSchema: json.RawMessage(emptyObjectSchema),
		Handler:     c.handleInferenceUsage,
	}
}

type usageRow struct {
	Date         string `json:"date"`
	Model        string `json:"model"`
	Calls        int64  `json:"calls"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
}

type usageTotal struct {
	Calls        int64 `json:"calls"`
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}

type usagePayload struct {
	Rows  []usageRow `json:"rows"`
	Total usageTotal `json:"total"`
}

func (c *instanceCapability) handleInferenceUsage(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	days, err := c.deps.Usage.Summarize7Day(ctx, ownerID)
	if err != nil {
		c.log.Error("cap instance.inference_usage", "err", err)
		return capreg.MCPError("inference usage query failed")
	}
	rows := make([]usageRow, 0, len(days))
	var total usageTotal
	for i := range days {
		rows = append(rows, usageRow{
			Date: days[i].Day.Format("2006-01-02"), Model: days[i].Model,
			Calls: days[i].Calls, InputTokens: days[i].InputTokens,
			OutputTokens: days[i].OutputTokens,
		})
		total.Calls += days[i].Calls
		total.InputTokens += days[i].InputTokens
		total.OutputTokens += days[i].OutputTokens
	}
	return mcputil.MarshalResult(c.log, "instance.inference_usage",
		usagePayload{Rows: rows, Total: total})
}

// ───── instance.corpus_growth ───────────────────────────────────

func (c *instanceCapability) corpusGrowthBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "instance.corpus_growth",
		Description: "Corpus growth: 14-day new-entry series, 7-day delta, and current " +
			"per-tier totals (raw/wiki/output).",
		InputSchema: json.RawMessage(emptyObjectSchema),
		Handler:     c.handleCorpusGrowth,
	}
}

type dayCount struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

type tierCounts struct {
	Raw    int `json:"raw"`
	Wiki   int `json:"wiki"`
	Output int `json:"output"`
}

type growthPayload struct {
	Series  []dayCount `json:"series"`
	ByTier  tierCounts `json:"by_tier"`
	Total   int        `json:"total"`
	Delta7d int        `json:"delta_7d"`
}

func (c *instanceCapability) handleCorpusGrowth(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	g, err := c.deps.Growth.CorpusGrowth(ctx, ownerID)
	if err != nil {
		c.log.Error("cap instance.corpus_growth", "err", err)
		return capreg.MCPError("corpus growth query failed")
	}
	series := make([]dayCount, 0, len(g.Series))
	for i := range g.Series {
		series = append(series, dayCount{Day: g.Series[i].Day, Count: g.Series[i].Count})
	}
	return mcputil.MarshalResult(c.log, "instance.corpus_growth", growthPayload{
		Series:  series,
		ByTier:  tierCounts{Raw: g.ByTier.Raw, Wiki: g.ByTier.Wiki, Output: g.ByTier.Output},
		Total:   g.Total,
		Delta7d: g.Delta7d,
	})
}

// ───── instance.activity ────────────────────────────────────────

func (c *instanceCapability) activityBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "instance.activity",
		Description: "Recent activity events (visitor / ingest / booking), newest first, " +
			"each a {kind, at, label}.",
		InputSchema: json.RawMessage(emptyObjectSchema),
		Handler:     c.handleActivity,
	}
}

type activityEvent struct {
	Kind  string `json:"kind"`
	At    string `json:"at"`
	Label string `json:"label"`
}

type activityPayload struct {
	Events []activityEvent `json:"events"`
}

func (c *instanceCapability) handleActivity(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	events, err := c.deps.Activity.RecentActivity(ctx, ownerID, defaultListLimit)
	if err != nil {
		c.log.Error("cap instance.activity", "err", err)
		return capreg.MCPError("recent activity query failed")
	}
	out := make([]activityEvent, 0, len(events))
	for i := range events {
		out = append(out, activityEvent{
			Kind: events[i].Kind, At: events[i].At.UTC().Format(mcpTimeFmt), Label: events[i].Label,
		})
	}
	return mcputil.MarshalResult(c.log, "instance.activity", activityPayload{Events: out})
}

// ───── instance.jobs ────────────────────────────────────────────

func (c *instanceCapability) jobsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "instance.jobs",
		Description: "Registered background scheduled jobs and each one's last-run time " +
			"and status (scheduled / ok / error).",
		InputSchema: json.RawMessage(emptyObjectSchema),
		Handler:     c.handleJobs,
	}
}

type jobRow struct {
	LastRun    *string `json:"last_run"`
	Name       string  `json:"name"`
	Schedule   string  `json:"schedule"`
	LastStatus string  `json:"last_status"`
}

type jobsPayload struct {
	Jobs []jobRow `json:"jobs"`
}

func (c *instanceCapability) handleJobs(
	_ context.Context, _ string, _ json.RawMessage,
) capreg.MCPResult {
	jobs := c.deps.Jobs.ScheduledJobs()
	out := make([]jobRow, 0, len(jobs))
	for i := range jobs {
		var lastRun *string
		if jobs[i].LastRun != nil {
			s := jobs[i].LastRun.UTC().Format(mcpTimeFmt)
			lastRun = &s
		}
		out = append(out, jobRow{
			LastRun: lastRun, Name: jobs[i].Name,
			Schedule: jobs[i].Schedule, LastStatus: jobs[i].LastStatus,
		})
	}
	return mcputil.MarshalResult(c.log, "instance.jobs", jobsPayload{Jobs: out})
}
