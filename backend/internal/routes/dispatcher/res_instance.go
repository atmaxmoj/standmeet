// res_instance.go —— 资源 instance:这台实例自己的可观测面。全是只读。
//
//	status           版本 / 运行时长 / 依赖健康 / 内存磁盘负载
//	inference_usage  近 7 天 LLM 用量
//	corpus_growth    语料增长(14 天曲线 + 分层总数)
//	corpus_graph     语料链接图(节点 + 链接度)
//	activity         最近事件流
//	jobs             后台计划任务
//
// 迁移时补了两处两个面对不上的地方:
//
//   - corpus_growth 的 by_tier,admin 一直给 5 个数(raw/wiki/output/writing/raw_unprocessed),
//     MCP 只给前 3 个 —— owner 从 Claude Code 看不到 writing 数和待处理的 raw 数。
//   - corpus_graph **在 MCP 上根本不存在**,而且它连那张手写对照表里都没有一行 ——
//     一条既没有 MCP 孪生、也没被台账登记的 admin 路由,棘轮从来就看不见它。
//     声明成一个 op 之后,两个面都欠它,漏不掉。

package dispatcher

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// graphDefaultLimit —— 语料图默认取多少个节点。
const graphDefaultLimit = 60

// InstanceStore —— instance 这组只读操作所需的最小口。
type InstanceStore interface {
	Status(ctx context.Context) InstanceStatus
	InferenceUsage(ctx context.Context, ownerID string) (InferenceUsage, error)
	CorpusGrowth(ctx context.Context, ownerID string) (CorpusGrowth, error)
	CorpusGraph(ctx context.Context, ownerID string, limit int) ([]GraphNode, error)
	Activity(ctx context.Context, ownerID string) ([]ActivityEvent, error)
	Jobs() []ScheduledJob
}

// Instance —— instance 资源:六个只读观测口。
func Instance(store InstanceStore) Resource {
	return Resource{Name: "instance", Ops: []Op{
		{
			ID: "instance.status",
			Description: "Instance health snapshot: version, uptime, dependency health pings " +
				"(db/redis/storage), Go runtime + host memory/disk/load.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      instanceStatus(store),
		},
		{
			ID: "instance.inference_usage",
			Description: "Last 7 days of LLM inference usage, one row per day×model " +
				"(calls / input tokens / output tokens) plus a grand total.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      instanceInferenceUsage(store),
		},
		{
			ID: "instance.corpus_growth",
			Description: "Corpus growth: 14-day new-entry series, 7-day delta, and current " +
				"per-tier totals (raw / wiki / output / writing / unprocessed raw).",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      instanceCorpusGrowth(store),
		},
		{
			ID: "instance.corpus_graph",
			Description: "Corpus link constellation: notes with their link degree " +
				"(how many note_refs touch them, both directions). Hubs have the " +
				"highest degree.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"limit":{"type":"integer","description":"Max nodes (default 60)."}
				}
			}`),
			Kind:   fp.Read,
			Reach:  fp.OwnerRead(),
			Invoke: instanceCorpusGraph(store),
		},
		{
			ID: "instance.activity",
			Description: "Recent activity events (visitor / ingest / booking), newest first, " +
				"each a {kind, at, label}.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      instanceActivity(store),
		},
		{
			ID: "instance.jobs",
			Description: "Registered background scheduled jobs and each one's last-run time " +
				"and status (scheduled / ok / error).",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      instanceJobs(store),
		},
	}}
}

var emptyArgsSchema = json.RawMessage(`{"type":"object","properties":{}}`)
