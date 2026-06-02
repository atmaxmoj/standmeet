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
		func(_ context.Context, args string) (string, error) {
			return r.runSearch([]byte(args))
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
		func(_ context.Context, args string) (string, error) {
			return r.runRead([]byte(args))
		},
	)
}

func listBindingTool(r *retriever) agentskills.BindingTool {
	return agentskills.NewTool(
		toolListCorpus,
		"List corpus entry paths optionally filtered by prefix.",
		"listing entries",
		json.RawMessage(`{
			"type": "object",
			"properties": {"prefix": {"type": "string"}}
		}`),
		func(_ context.Context, args string) (string, error) {
			return r.runList([]byte(args))
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
	wikis     []domain.Wiki
	outputs   []domain.Output
	writings  []domain.Writing
}

// retrieverInput —— newRetriever 入参打包，避开 5-arg 上限。snapshot 必填。
type retrieverInput struct {
	snapshot *domain.RoleSnapshot
	wikis    []domain.Wiki
	outputs  []domain.Output
	writings []domain.Writing
}

func newRetriever(in *retrieverInput) *retriever {
	return &retriever{
		wikis: in.wikis, outputs: in.outputs, writings: in.writings,
		snapshot:  in.snapshot,
		collector: newReadCollector(),
	}
}

// allowsPath / allowsEntry 拆到 visitor_chat_tools_read.go。
// runSearch / runRead / runList 各自被对应 BindingTool 闭包调用。

func (r *retriever) runSearch(input []byte) (string, error) {
	var args struct {
		Query string `json:"query"`
	}
	if uerr := json.Unmarshal(input, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	q := strings.ToLower(strings.TrimSpace(args.Query))
	rows := r.collectMatchingEntries(q)
	return marshalRows(rows), nil
}

type corpusRow struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Genre   string `json:"genre"`
	Summary string `json:"summary,omitempty"`
}

func (r *retriever) collectMatchingEntries(q string) []corpusRow {
	out := make([]corpusRow, 0, len(r.wikis)+len(r.outputs)+len(r.writings))
	out = append(out, r.matchOutputs(q)...)
	out = append(out, r.matchWikis(q)...)
	out = append(out, r.matchWritings(q)...)
	return out
}

func (r *retriever) matchOutputs(q string) []corpusRow {
	out := make([]corpusRow, 0, len(r.outputs))
	for i := range r.outputs {
		if r.outputMatches(&r.outputs[i], q) {
			out = append(out, outputToRow(&r.outputs[i]))
		}
	}
	return out
}

func (r *retriever) matchWikis(q string) []corpusRow {
	out := make([]corpusRow, 0, len(r.wikis))
	for i := range r.wikis {
		if r.wikiMatches(&r.wikis[i], q) {
			out = append(out, wikiToRow(&r.wikis[i]))
		}
	}
	return out
}

func (r *retriever) matchWritings(q string) []corpusRow {
	out := make([]corpusRow, 0, len(r.writings))
	for i := range r.writings {
		if r.writingMatches(&r.writings[i], q) {
			out = append(out, writingToRow(&r.writings[i]))
		}
	}
	return out
}

// writing-specific helpers live in visitor_chat_tools_writings.go to keep
// this file under the 350-line cap.

// runRead —— 按 path 查 entry，ACL 通过 + show_as_source 不抑制时进 collector。
// ACL 评估走 dispatchRead 内部按 genre 检 (snapshot mode 需要 genre 拼 URI；
// legacy PathACL 模式下 r.allowsPath 忽略 genre 等同 r.acl.AllowsPath)。
func (r *retriever) runRead(input []byte) (string, error) {
	path, perr := parseReadPath(input)
	if perr != nil {
		return "", perr
	}
	if path == "" {
		return errJSON("path required"), nil
	}
	return r.dispatchRead(path), nil
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

func (r *retriever) findWikiByPath(path string) *domain.Wiki {
	for i := range r.wikis {
		if wikiPath(&r.wikis[i]) == path {
			return &r.wikis[i]
		}
	}
	return nil
}

func (r *retriever) findOutputByPath(path string) *domain.Output {
	for i := range r.outputs {
		if outputPath(&r.outputs[i]) == path {
			return &r.outputs[i]
		}
	}
	return nil
}

// runList —— 按 prefix filter，返 path/title/kind。
func (r *retriever) runList(input []byte) (string, error) {
	var args struct {
		Prefix string `json:"prefix"`
	}
	if uerr := json.Unmarshal(input, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	rows := r.listEntries(args.Prefix)
	return marshalRows(rows), nil
}

func (r *retriever) listEntries(prefix string) []corpusRow {
	out := make([]corpusRow, 0, len(r.wikis)+len(r.outputs)+len(r.writings))
	out = append(out, r.listOutputsByPrefix(prefix)...)
	out = append(out, r.listWikisByPrefix(prefix)...)
	out = append(out, r.listWritingsByPrefix(prefix)...)
	return out
}

func (r *retriever) listOutputsByPrefix(prefix string) []corpusRow {
	out := make([]corpusRow, 0, len(r.outputs))
	for i := range r.outputs {
		if row, ok := r.listOutputRow(&r.outputs[i], prefix); ok {
			out = append(out, row)
		}
	}
	return out
}

func (r *retriever) listWikisByPrefix(prefix string) []corpusRow {
	out := make([]corpusRow, 0, len(r.wikis))
	for i := range r.wikis {
		if row, ok := r.listWikiRow(&r.wikis[i], prefix); ok {
			out = append(out, row)
		}
	}
	return out
}

func (r *retriever) listWritingsByPrefix(prefix string) []corpusRow {
	out := make([]corpusRow, 0, len(r.writings))
	for i := range r.writings {
		if row, ok := r.listWritingRow(&r.writings[i], prefix); ok {
			out = append(out, row)
		}
	}
	return out
}

func (r *retriever) listWikiRow(w *domain.Wiki, prefix string) (corpusRow, bool) {
	p := w.PathOrEmpty()
	if !r.allowsEntry(domain.GenreWiki, p) || !strings.HasPrefix(p, prefix) {
		return corpusRow{}, false
	}
	return corpusRow{Path: p, Title: w.Title(), Genre: "wiki"}, true
}

func (r *retriever) listOutputRow(o *domain.Output, prefix string) (corpusRow, bool) {
	p := o.PathOrEmpty()
	if !r.allowsEntry(domain.GenreOutput, p) || !strings.HasPrefix(p, prefix) {
		return corpusRow{}, false
	}
	return corpusRow{Path: p, Title: o.Title(), Genre: "output"}, true
}

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

// marshalGenreBodyPath —— corpus_read 的 tool result wire 形态。包 4 个
// 字段：genre (wiki/output/writing) + body (markdown，含 mermaid/latex
// 等内嵌元素) + path + title。frontend pi-agent-core 收到后累积 citations
// (genre + path + title 用于 UI；body 用于 G-3 inline 展开)。
func marshalGenreBodyPath(genre, body, path, title string) string {
	out, err := json.Marshal(map[string]string{
		"genre": genre, "body": body, "path": path, "title": title,
	})
	if err != nil {
		return errJSON("marshal failed")
	}
	return string(out)
}
