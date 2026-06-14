// visitor_chat_tools.go —— visitor chat 的 server-side retrieval tools。
//
// 设计源自 legacy standmeet-server/gateway/src/runtime/mcp-tools.ts：把
// retrieval 从"server 端预 stuff 全集进 prompt"换成"AI 主动 search/read"。
// 让 cited = AI 真读过的 entry，而不是 ACL-filtered corpus 全集。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

// searchPageLimit —— DB 搜索一页上限(翻页留给 LLM 用 offset)。
const searchPageLimit = 20

const (
	// Tool names —— Phase D-3 切到 snake_case (URL `/tools/{name}` 跟 LLM
	// tool spec 1:1)；Anthropic-friendly。capability ID 自己仍是点分
	// (`corpus.retrieval`)，是 internal 层级概念，不进 URL / LLM spec。
	toolSearchCorpus = "corpus_search"
	toolReadCorpus   = "corpus_read"
	toolListCorpus   = "corpus_list"
	summaryMaxChars  = 160
)

// searchBindingTool / readBindingTool / listBindingTool —— 三个 tool 各
// 自的 spec + RunFn 闭包，每个绑到 retriever 对应方法 (G-8 throbber 文
// 案 + JSON schema 都在这一行装好；eino tool.InvokableTool 在 NewTool
// 内部生成)。
func searchBindingTool(r *retriever) agentskills.BindingTool {
	return agentskills.NewTool(
		toolSearchCorpus,
		"Search owner's curated corpus by keyword. Returns "+
			"matching wiki + output entries with path, title, genre, summary.",
		"searching corpus",
		json.RawMessage(`{
			"type": "object",
			"properties": {"query": {"type": "string"}},
			"required": ["query"]
		}`),
		func(ctx context.Context, args string) (string, error) {
			return r.runSearch(ctx, []byte(args))
		},
	)
}

func readBindingTool(r *retriever) agentskills.BindingTool {
	return agentskills.NewTool(
		toolReadCorpus,
		"Read the full body of a corpus entry by its path "+
			"(e.g. projects/lucerna). Use after search to fetch content.",
		"reading entry",
		json.RawMessage(`{
			"type": "object",
			"properties": {"path": {"type": "string"}},
			"required": ["path"]
		}`),
		func(ctx context.Context, args string) (string, error) {
			return r.runRead(ctx, []byte(args))
		},
	)
}

func listBindingTool(r *retriever) agentskills.BindingTool {
	return agentskills.NewTool(
		toolListCorpus,
		"Navigate the wiki tree one level at a time. Omit path to list root "+
			"entries; pass a node's path to list its direct children (empty result "+
			"means it's a leaf). Use page (0-based) to page through a wide level.",
		"listing entries",
		json.RawMessage(`{
			"type": "object",
			"properties": {
				"path": {"type": "string"},
				"page": {"type": "integer"}
			}
		}`),
		func(ctx context.Context, args string) (string, error) {
			return r.runList(ctx, []byte(args))
		},
	)
}

// retriever —— tool executor 的状态。writings 跟 wiki/output 共享 search/
// read/list；cited footer 仅 wiki+output (writings 有自己的 cross_refs +
// "ask about this essay" 入口，不挤 cited 列表)。
//
// ACL 评估：[[role_snapshot]].AllowsCorpus —— A.3-IAM-5 起 snapshot 必填。
type retriever struct {
	collector *readCollector
	snapshot  *domain.RoleSnapshot
	// wikiRepo / outputRepo / writingRepo —— 三个 genre 都走 DB:全量搜(Search)+ 按
	// path 读,不吃内存窗口。
	wikiRepo    WikiLister
	outputRepo  OutputLister
	writingRepo WritingLister
	// id→树派生 path(见 corpus_tree_path.go)。(map 字段排在 slice 前,fieldalignment。)
	wikiPaths   map[string]string
	outputPaths map[string]string
	// seen / outputSeen —— DB 搜出来的 path→id 缓存(read 按 path 反查 id);顺 parent_id
	// 上溯算 path 后填,LLM「read after search」命中超出内存 50 的条目也能读到。
	seen       map[string]string
	outputSeen map[string]string
	ownerID    string
	// slice 收尾(末两字 len/cap 无指针 → 缩 GC pointer-bytes,fieldalignment)。
	wikis    []domain.Wiki
	outputs  []domain.Output
	writings []domain.Writing
}

// retrieverInput —— newRetriever 入参打包，避开 5-arg 上限。snapshot 必填。
type retrieverInput struct {
	snapshot    *domain.RoleSnapshot
	wikiRepo    WikiLister
	outputRepo  OutputLister
	writingRepo WritingLister
	ownerID     string
	wikis       []domain.Wiki
	outputs     []domain.Output
	writings    []domain.Writing
}

func newRetriever(in *retrieverInput) *retriever {
	return &retriever{
		wikis: in.wikis, outputs: in.outputs, writings: in.writings,
		snapshot:    in.snapshot,
		wikiRepo:    in.wikiRepo,
		outputRepo:  in.outputRepo,
		writingRepo: in.writingRepo,
		ownerID:     in.ownerID,
		collector:   newReadCollector(),
		wikiPaths:   WikiTreePaths(in.wikis),
		outputPaths: OutputTreePaths(in.outputs),
		seen:        make(map[string]string),
		outputSeen:  make(map[string]string),
	}
}

// wikiPath / outputPath —— entry 的树派生地址。一律走预算好的表(永远非空,见
// corpus_tree_path.go);不再用可空的 path 列或 `<kind>/<id>` 兜底。
func (r *retriever) wikiPath(w *domain.Wiki) string     { return r.wikiPaths[w.ID()] }
func (r *retriever) outputPath(o *domain.Output) string { return r.outputPaths[o.ID()] }

// allowsPath / allowsEntry 拆到 visitor_chat_tools_read.go。
// runSearch / runRead / runList 各自被对应 BindingTool 闭包调用。

func (r *retriever) runSearch(ctx context.Context, input []byte) (string, error) {
	var args struct {
		Query string `json:"query"`
	}
	if uerr := json.Unmarshal(input, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	q := strings.TrimSpace(args.Query)
	rows := r.collectMatchingEntries(ctx, q)
	return marshalRows(rows), nil
}

type corpusRow struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Genre   string `json:"genre"`
	Summary string `json:"summary,omitempty"`
}

func (r *retriever) collectMatchingEntries(ctx context.Context, q string) []corpusRow {
	out := make([]corpusRow, 0, len(r.outputs)+len(r.writings))
	out = append(out, r.matchOutputs(ctx, q)...)
	out = append(out, r.matchWikis(ctx, q)...)
	out = append(out, r.matchWritings(ctx, q)...)
	return out
}

// matchWikis / matchOutputs / matchWritings(+ *HitToRow)拆到
// visitor_chat_tools_wiki.go / _writings.go 守 350-line cap。

// writing-specific helpers live in visitor_chat_tools_writings.go to keep
// this file under the 350-line cap.

// runRead —— 按 path 查 entry，ACL 通过 + show_as_source 不抑制时进 collector。
// ACL 评估走 dispatchRead 内部按 genre 检 (snapshot mode 需要 genre 拼 URI；
// legacy PathACL 模式下 r.allowsPath 忽略 genre 等同 r.acl.AllowsPath)。
func (r *retriever) runRead(ctx context.Context, input []byte) (string, error) {
	path, perr := parseReadPath(input)
	if perr != nil {
		return "", perr
	}
	if path == "" {
		return errJSON("path required"), nil
	}
	return r.dispatchRead(ctx, path), nil
}

func parseReadPath(input []byte) (string, error) {
	var args struct {
		Path string `json:"path"`
	}
	if uerr := json.Unmarshal(input, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	return args.Path, nil
}

// dispatchRead / serveXRead helpers 拆到 visitor_chat_tools_read.go 守
// max-lines 350 line cap。

// findWikiByPath —— path → entry,DB 优先(不吃内存 50-cap):先 seen 缓存(同回合
// search/list 填的 path→id),否则顺树 resolve path→id;两路都 GetByID 拉 body。最后
// 退回内存 wikis(老路径/小 corpus 兼容)。跨 tool 调用(各自新 retriever,seen 空)
// 也能按 path 读到任意深度条目。
func (r *retriever) findWikiByPath(ctx context.Context, path string) *domain.Wiki {
	if w, ok := r.readWikiViaRepo(ctx, path); ok {
		return w
	}
	for i := range r.wikis {
		if r.wikiPath(&r.wikis[i]) == path {
			return &r.wikis[i]
		}
	}
	return nil
}

// readWikiViaRepo —— DB 路:seen 命中直接拿 id,否则顺 root→下 resolve path→id;再
// GetByID。解不出(未知 path)/读不到 → (nil,false),交回内存兜底。
func (r *retriever) readWikiViaRepo(ctx context.Context, path string) (*domain.Wiki, bool) {
	id, ok := r.seen[path]
	if !ok {
		resolved, rerr := resolveWikiNodeID(ctx, r.wikiRepo, r.ownerID, path)
		if rerr != nil {
			return nil, false
		}
		id = resolved
	}
	w, err := r.wikiRepo.GetByID(ctx, r.ownerID, id)
	if err != nil {
		return nil, false
	}
	return &w, true
}

// findOutputByPath —— path → output,DB 优先(不吃 50-cap):outputSeen 命中(同回合
// search 填的 path→id)→ GetByID;否则退回内存 outputs(小 corpus 兼容)。
func (r *retriever) findOutputByPath(ctx context.Context, path string) *domain.Output {
	if id, ok := r.outputSeen[path]; ok {
		if o, err := r.outputRepo.GetByID(ctx, r.ownerID, id); err == nil {
			return &o
		}
	}
	for i := range r.outputs {
		if r.outputPath(&r.outputs[i]) == path {
			return &r.outputs[i]
		}
	}
	return nil
}

// runList / listEntries / list*ByPrefix / list*Row 拆到 visitor_chat_tools_list.go
// 守 max-lines 350 line cap。

// errJSON / marshalRows / marshalKindBody —— tool 返回都是 JSON string。
// 用辅助函数集中 marshal + 失败兜底，避免散落 errcheck 告警。
func errJSON(msg string) string {
	out, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		return `{"error":"marshal failed"}`
	}
	return string(out)
}

func marshalRows(rows []corpusRow) string {
	out, err := json.Marshal(rows)
	if err != nil {
		return errJSON("marshal failed")
	}
	return string(out)
}

// marshalReadResult —— corpus_read 的 tool result wire 形态。字段:id(entry
// 稳定标识,前端按它引用 → admin transcript 记 cited_*_ids,绕开按路径反查 +
// ACL 子集对不上的坑)+ genre + body(markdown,含 mermaid/latex 等内嵌)+ path
// (树派生地址,UI 显示 + AI 后续 corpus_read 用)+ title。前端 pi-agent-core
// 收到后累积 citations(id 落库 / genre+path+title 给 UI / body 给 G-3 展开)。
func marshalReadResult(id, genre, body, path, title string) string {
	out, err := json.Marshal(map[string]string{
		"id": id, "genre": genre, "body": body, "path": path, "title": title,
	})
	if err != nil {
		return errJSON("marshal failed")
	}
	return string(out)
}
