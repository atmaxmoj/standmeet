// Package ops —— stats 域对外能做的事:这台实例自己的可观测面。全是只读。
//
//	status           版本 / 运行时长 / 依赖健康 / 内存磁盘负载
//	inference_usage  近 7 天 LLM 用量
//	corpus_growth    语料增长(14 天曲线 + 分层总数)
//	corpus_graph     语料链接图(节点 + 链接度)
//	activity         最近事件流
//	jobs             后台计划任务
//
// 迁移时补过两处两个面对不上的地方:corpus_growth 的 by_tier 面板给 5 个数、MCP 只给 3 个;
// corpus_graph **在 MCP 上根本不存在**,而且它连那张手写对照表里都没有一行 —— 一条既没有
// MCP 孪生、也没被登记的路由,棘轮从来看不见。现在两个面都欠它们。
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
	// graphDefaultLimit —— 语料图默认取多少个节点。
	graphDefaultLimit = 60
	// activityFeedLimit —— 活动流一次给多少条。
	activityFeedLimit = 20
	// dayFormat —— 用量按天分组,日期就是这个格式。
	dayFormat = "2006-01-02"
)

var noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// SystemInfoSource —— 进程和主机的运行时快照从哪儿来。版本号、goroutine 数、磁盘占用
// 是**进程自己**知道的事,不是这个域的数据,所以走窄口由组装根注入。
// 形状用域已有的 entity.SystemInfo,不另起一份。
type SystemInfoSource interface {
	SystemInfo(ctx context.Context) entity.SystemInfo
}

// InstanceDeps —— 这一组要的五个来源。
type InstanceDeps struct {
	System   SystemInfoSource
	Usage    *repo.InferenceUsageRepo
	Growth   *repo.GrowthRepo
	Activity *repo.ActivityRepo
	Jobs     *entity.JobRegistry
}

// Instance —— 六个只读观测口。
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

// formatOptionalTime —— nil 保持 null(前端据此显示"还没跑过")。
func formatOptionalTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}
