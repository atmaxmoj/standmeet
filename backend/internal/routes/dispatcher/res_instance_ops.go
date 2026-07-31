// res_instance_ops.go —— instance 资源的调用 / 序列化(声明在 res_instance.go)。
//
// 全是只读,所以这里没有校验,只有形状转换。出站字段名就是 admin 已经发出去的那套。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type healthRow struct {
	Name   string `json:"name"`
	Detail string `json:"detail"`
	OK     bool   `json:"ok"`
}

type statusOut struct {
	Version       string      `json:"version"`
	Health        []healthRow `json:"health"`
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

func instanceStatus(store InstanceStore) Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		info := store.Status(ctx)
		health := make([]healthRow, 0, len(info.Health))
		for i := range info.Health {
			health = append(health, healthRow{
				Name: info.Health[i].Name, Detail: info.Health[i].Detail, OK: info.Health[i].OK,
			})
		}
		return marshalOut(statusOut{
			Version: info.Version, UptimeSeconds: info.UptimeSeconds,
			Goroutines: info.Goroutines, MemAllocMB: info.MemAllocMB,
			DiskTotalMB: info.DiskTotalMB, DiskFreeMB: info.DiskFreeMB,
			MemTotalMB: info.MemTotalMB, MemUsedMB: info.MemUsedMB,
			LoadAvg1: info.LoadAvg1, NumCPU: info.NumCPU, Health: health,
		})
	}
}

type usageRowOut struct {
	Date         string `json:"date"`
	Model        string `json:"model"`
	Calls        int64  `json:"calls"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
}

type usageTotalOut struct {
	Calls        int64 `json:"calls"`
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}

type usageOut struct {
	Rows  []usageRowOut `json:"rows"`
	Total usageTotalOut `json:"total"`
}

func instanceInferenceUsage(store InstanceStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		usage, err := store.InferenceUsage(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("inference usage: %w", err)
		}
		rows := make([]usageRowOut, 0, len(usage.Rows))
		for i := range usage.Rows {
			rows = append(rows, usageRowOut{
				Date: usage.Rows[i].Date, Model: usage.Rows[i].Model,
				Calls: usage.Rows[i].Calls, InputTokens: usage.Rows[i].InputTokens,
				OutputTokens: usage.Rows[i].OutputTokens,
			})
		}
		return marshalOut(usageOut{Rows: rows, Total: usageTotalOut{
			Calls:       usage.Total.Calls,
			InputTokens: usage.Total.InputTokens, OutputTokens: usage.Total.OutputTokens,
		}})
	}
}

type dayCountOut struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

type tierCountsOut struct {
	Raw            int `json:"raw"`
	Wiki           int `json:"wiki"`
	Output         int `json:"output"`
	Writing        int `json:"writing"`
	RawUnprocessed int `json:"raw_unprocessed"`
}

type growthOut struct {
	Series  []dayCountOut `json:"series"`
	ByTier  tierCountsOut `json:"by_tier"`
	Total   int           `json:"total"`
	Delta7d int           `json:"delta_7d"`
}

func instanceCorpusGrowth(store InstanceStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		g, err := store.CorpusGrowth(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("corpus growth: %w", err)
		}
		series := make([]dayCountOut, 0, len(g.Series))
		for i := range g.Series {
			series = append(series, dayCountOut{Day: g.Series[i].Day, Count: g.Series[i].Count})
		}
		return marshalOut(growthOut{
			Series: series, Total: g.Total, Delta7d: g.Delta7d,
			ByTier: tierCountsOut{
				Raw: g.ByTier.Raw, Wiki: g.ByTier.Wiki, Output: g.ByTier.Output,
				Writing: g.ByTier.Writing, RawUnprocessed: g.ByTier.RawUnprocessed,
			},
		})
	}
}

type graphNodeOut struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Genre  string `json:"genre"`
	Degree int    `json:"degree"`
}

type graphOut struct {
	Nodes []graphNodeOut `json:"nodes"`
}

type graphArgs struct {
	Limit int `json:"limit"`
}

// parseGraphLimit —— 没给或给了非正数就用默认值(它是个展示上限,不是校验项)。
func parseGraphLimit(raw json.RawMessage) (int, error) {
	var in graphArgs
	if err := decodeOptional(raw, &in); err != nil {
		return 0, err
	}
	if in.Limit <= 0 {
		return graphDefaultLimit, nil
	}
	return in.Limit, nil
}

func instanceCorpusGraph(store InstanceStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		limit, perr := parseGraphLimit(raw)
		if perr != nil {
			return nil, perr
		}
		nodes, err := store.CorpusGraph(ctx, ownerID, limit)
		if err != nil {
			return nil, fmt.Errorf("corpus graph: %w", err)
		}
		out := make([]graphNodeOut, 0, len(nodes))
		for i := range nodes {
			out = append(out, graphNodeOut{
				ID: nodes[i].ID, Title: nodes[i].Title,
				Genre: nodes[i].Genre, Degree: nodes[i].Degree,
			})
		}
		return marshalOut(graphOut{Nodes: out})
	}
}

type activityEventOut struct {
	Kind  string `json:"kind"`
	At    string `json:"at"`
	Label string `json:"label"`
}

type activityOut struct {
	Events []activityEventOut `json:"events"`
}

func instanceActivity(store InstanceStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		events, err := store.Activity(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("recent activity: %w", err)
		}
		out := make([]activityEventOut, 0, len(events))
		for i := range events {
			out = append(out, activityEventOut{
				Kind:  events[i].Kind,
				At:    events[i].At.UTC().Format(time.RFC3339),
				Label: events[i].Label,
			})
		}
		return marshalOut(activityOut{Events: out})
	}
}

type jobRowOut struct {
	LastRun    *string `json:"last_run"`
	Name       string  `json:"name"`
	Schedule   string  `json:"schedule"`
	LastStatus string  `json:"last_status"`
}

type jobsOut struct {
	Jobs []jobRowOut `json:"jobs"`
}

func instanceJobs(store InstanceStore) Invoke {
	return func(_ context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		jobs := store.Jobs()
		out := make([]jobRowOut, 0, len(jobs))
		for i := range jobs {
			out = append(out, jobRowOut{
				LastRun: formatOptionalTime(jobs[i].LastRun), Name: jobs[i].Name,
				Schedule: jobs[i].Schedule, LastStatus: jobs[i].LastStatus,
			})
		}
		return marshalOut(jobsOut{Jobs: out})
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
