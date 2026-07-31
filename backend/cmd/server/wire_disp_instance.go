// wire_disp_instance.go —— stats 域的观测读 → 出站收口的窄口。
//
// 这里的五个数据源(系统信息 / 用量 / 增长 / 活动 / 任务表)本来就分散在几个 repo 上,
// 收口只要一个 store —— 拼起来是组装根的事。

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

const (
	// activityFeedLimit —— 活动流一次给多少条。
	activityFeedLimit = 20
	// dayFormat —— 用量按天分组,日期就是这个格式。
	dayFormat = "2006-01-02"
)

type instanceOps struct {
	system   *sysInfoProvider
	usage    *stats.InferenceUsageRepo
	growth   *stats.GrowthRepo
	activity *stats.ActivityRepo
	jobs     *stats.JobRegistry
}

func newInstanceOps(d *runtimeDeps) instanceOps {
	return instanceOps{
		system: newSysInfoProvider(d), usage: d.inferenceUsageRepo,
		growth: d.growthRepo, activity: d.activityRepo, jobs: d.jobRegistry,
	}
}

func (a instanceOps) Status(ctx context.Context) dispatcher.InstanceStatus {
	info := a.system.SystemInfo(ctx)
	health := make([]dispatcher.HealthCheck, 0, len(info.Health))
	for i := range info.Health {
		health = append(health, dispatcher.HealthCheck{
			Name: info.Health[i].Name, Detail: info.Health[i].Detail, OK: info.Health[i].OK,
		})
	}
	return dispatcher.InstanceStatus{
		Version: info.Version, UptimeSeconds: info.UptimeSeconds, Goroutines: info.Goroutines,
		MemAllocMB: info.MemAllocMB, DiskTotalMB: info.DiskTotalMB, DiskFreeMB: info.DiskFreeMB,
		MemTotalMB: info.MemTotalMB, MemUsedMB: info.MemUsedMB, LoadAvg1: info.LoadAvg1,
		NumCPU: info.NumCPU, Health: health,
	}
}

func (a instanceOps) InferenceUsage(
	ctx context.Context, ownerID string,
) (dispatcher.InferenceUsage, error) {
	days, err := a.usage.Summarize7Day(ctx, ownerID)
	if err != nil {
		return dispatcher.InferenceUsage{}, fmt.Errorf("summarize 7-day usage: %w", err)
	}
	out := dispatcher.InferenceUsage{Rows: make([]dispatcher.UsageRow, 0, len(days))}
	for i := range days {
		out.Rows = append(out.Rows, dispatcher.UsageRow{
			Date: days[i].Day.Format(dayFormat), Model: days[i].Model,
			Calls: days[i].Calls, InputTokens: days[i].InputTokens,
			OutputTokens: days[i].OutputTokens,
		})
		out.Total.Calls += days[i].Calls
		out.Total.InputTokens += days[i].InputTokens
		out.Total.OutputTokens += days[i].OutputTokens
	}
	return out, nil
}

func (a instanceOps) CorpusGrowth(
	ctx context.Context, ownerID string,
) (dispatcher.CorpusGrowth, error) {
	g, err := a.growth.CorpusGrowth(ctx, ownerID)
	if err != nil {
		return dispatcher.CorpusGrowth{}, fmt.Errorf("corpus growth: %w", err)
	}
	series := make([]dispatcher.DayCount, 0, len(g.Series))
	for i := range g.Series {
		series = append(series, dispatcher.DayCount{Day: g.Series[i].Day, Count: g.Series[i].Count})
	}
	return dispatcher.CorpusGrowth{
		Series: series, Total: g.Total, Delta7d: g.Delta7d,
		ByTier: dispatcher.TierCounts{
			Raw: g.ByTier.Raw, Wiki: g.ByTier.Wiki, Output: g.ByTier.Output,
			Writing: g.ByTier.Writing, RawUnprocessed: g.ByTier.RawUnprocessed,
		},
	}, nil
}

func (a instanceOps) CorpusGraph(
	ctx context.Context, ownerID string, limit int,
) ([]dispatcher.GraphNode, error) {
	nodes, err := a.activity.CorpusGraph(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("corpus graph: %w", err)
	}
	out := make([]dispatcher.GraphNode, 0, len(nodes))
	for i := range nodes {
		out = append(out, dispatcher.GraphNode{
			ID: nodes[i].ID, Title: nodes[i].Title,
			Genre: nodes[i].Genre, Degree: nodes[i].Degree,
		})
	}
	return out, nil
}

func (a instanceOps) Activity(
	ctx context.Context, ownerID string,
) ([]dispatcher.ActivityEvent, error) {
	events, err := a.activity.RecentActivity(ctx, ownerID, activityFeedLimit)
	if err != nil {
		return nil, fmt.Errorf("recent activity: %w", err)
	}
	out := make([]dispatcher.ActivityEvent, 0, len(events))
	for i := range events {
		out = append(out, dispatcher.ActivityEvent{
			At: events[i].At, Kind: events[i].Kind, Label: events[i].Label,
		})
	}
	return out, nil
}

func (a instanceOps) Jobs() []dispatcher.ScheduledJob {
	jobs := a.jobs.ScheduledJobs()
	out := make([]dispatcher.ScheduledJob, 0, len(jobs))
	for i := range jobs {
		out = append(out, dispatcher.ScheduledJob{
			LastRun: jobs[i].LastRun, Name: jobs[i].Name,
			Schedule: jobs[i].Schedule, LastStatus: jobs[i].LastStatus,
		})
	}
	return out
}
