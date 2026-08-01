// instance_reads.go —— 五个观测读的实现(声明在 instance.go)。全是形状转换,没有校验:
// 出站字段名就是面板已经发出去的那套。

package ops

import (
	"context"
	"encoding/json"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/stats/entity"
	"github.com/atmaxmoj/standmeet/internal/stats/repo"
)

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

func inferenceUsage(usage *repo.InferenceUsageRepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		days, err := usage.Summarize7Day(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("summarize 7-day usage", err)
		}
		out := usageOut{Rows: make([]usageRowOut, 0, len(days))}
		for i := range days {
			out.Rows = append(out.Rows, usageRowOut{
				Date: days[i].Day.Format(dayFormat), Model: days[i].Model,
				Calls: days[i].Calls, InputTokens: days[i].InputTokens,
				OutputTokens: days[i].OutputTokens,
			})
			out.Total.Calls += days[i].Calls
			out.Total.InputTokens += days[i].InputTokens
			out.Total.OutputTokens += days[i].OutputTokens
		}
		return json.Marshal(out)
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

func corpusGrowth(growth *repo.GrowthRepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		g, err := growth.CorpusGrowth(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("corpus growth", err)
		}
		series := make([]dayCountOut, 0, len(g.Series))
		for i := range g.Series {
			series = append(series, dayCountOut{Day: g.Series[i].Day, Count: g.Series[i].Count})
		}
		return json.Marshal(growthOut{
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

// graphLimit —— 没给或给了非正数就用默认值:它是展示上限,不是校验项。
func graphLimit(raw json.RawMessage) int {
	var in struct {
		Limit int `json:"limit"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &in) != nil || in.Limit <= 0 {
		return graphDefaultLimit
	}
	return in.Limit
}

func corpusGraph(activity *repo.ActivityRepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		nodes, err := activity.CorpusGraph(ctx, ownerID, graphLimit(raw))
		if err != nil {
			return nil, fp.OpErr("corpus graph", err)
		}
		out := make([]graphNodeOut, 0, len(nodes))
		for i := range nodes {
			out = append(out, graphNodeOut{
				ID: nodes[i].ID, Title: nodes[i].Title,
				Genre: nodes[i].Genre, Degree: nodes[i].Degree,
			})
		}
		return json.Marshal(graphOut{Nodes: out})
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

func recentActivity(activity *repo.ActivityRepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		events, err := activity.RecentActivity(ctx, ownerID, activityFeedLimit)
		if err != nil {
			return nil, fp.OpErr("recent activity", err)
		}
		out := make([]activityEventOut, 0, len(events))
		for i := range events {
			out = append(out, activityEventOut{
				Kind: events[i].Kind, Label: events[i].Label,
				At: events[i].At.UTC().Format(time.RFC3339),
			})
		}
		return json.Marshal(activityOut{Events: out})
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

func scheduledJobs(registry *entity.JobRegistry) fp.Invoke {
	return func(_ context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		jobs := registry.ScheduledJobs()
		out := make([]jobRowOut, 0, len(jobs))
		for i := range jobs {
			out = append(out, jobRowOut{
				LastRun: formatOptionalTime(jobs[i].LastRun), Name: jobs[i].Name,
				Schedule: jobs[i].Schedule, LastStatus: jobs[i].LastStatus,
			})
		}
		return json.Marshal(jobsOut{Jobs: out})
	}
}
