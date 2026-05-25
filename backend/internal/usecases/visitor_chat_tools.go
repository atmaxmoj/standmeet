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

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
)

const (
	toolSearchCorpus = "search_corpus_entries"
	toolReadCorpus   = "read_corpus_entry"
	toolListCorpus   = "list_corpus_entries"
	summaryMaxChars  = 160
)

// retrievalToolSpecs —— 三个 tool 的 JSON schema 定义。
func retrievalToolSpecs() []inference.ToolSpec {
	return []inference.ToolSpec{
		{
			Name: toolSearchCorpus,
			Description: "Search owner's curated corpus by keyword. Returns " +
				"matching wiki + output entries with path, title, kind, summary.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {"query": {"type": "string"}},
				"required": ["query"]
			}`),
		},
		{
			Name: toolReadCorpus,
			Description: "Read the full body of a corpus entry by its path " +
				"(e.g. projects/lucerna). Use after search to fetch content.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {"path": {"type": "string"}},
				"required": ["path"]
			}`),
		},
		{
			Name:        toolListCorpus,
			Description: "List corpus entry paths optionally filtered by prefix.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {"prefix": {"type": "string"}}
			}`),
		},
	}
}

// retriever —— tool executor 的状态。posts 跟 wiki/output 共享 search/
// read/list；cited footer 仅 wiki+output (posts 有自己的 cross_refs +
// "ask about this essay" 入口，不挤 cited 列表)。
type retriever struct {
	collector *readCollector
	wikis     []domain.WikiEntry
	outputs   []domain.OutputEntry
	posts     []domain.Post
	acl       domain.PathACL
}

// retrieverInput —— newRetriever 入参打包，避开 5-arg 上限。
type retrieverInput struct {
	wikis   []domain.WikiEntry
	outputs []domain.OutputEntry
	posts   []domain.Post
	perms   []domain.PathPermission
}

func newRetriever(in *retrieverInput) *retriever {
	return &retriever{
		wikis: in.wikis, outputs: in.outputs, posts: in.posts,
		acl:       domain.NewPathACL(in.perms),
		collector: newReadCollector(),
	}
}

// Execute —— inference.ToolExecutor 实现。
func (r *retriever) Execute(_ context.Context, name string, input []byte) (string, error) {
	switch name {
	case toolSearchCorpus:
		return r.runSearch(input)
	case toolReadCorpus:
		return r.runRead(input)
	case toolListCorpus:
		return r.runList(input)
	default:
		return "", fmt.Errorf("unknown tool: %s", name)
	}
}

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
	Kind    string `json:"kind"`
	Summary string `json:"summary,omitempty"`
}

func (r *retriever) collectMatchingEntries(q string) []corpusRow {
	out := make([]corpusRow, 0, len(r.wikis)+len(r.outputs)+len(r.posts))
	out = append(out, r.matchOutputs(q)...)
	out = append(out, r.matchWikis(q)...)
	out = append(out, r.matchPosts(q)...)
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

func (r *retriever) matchPosts(q string) []corpusRow {
	out := make([]corpusRow, 0, len(r.posts))
	for i := range r.posts {
		if r.postMatches(&r.posts[i], q) {
			out = append(out, postToRow(&r.posts[i]))
		}
	}
	return out
}

// post-specific helpers live in visitor_chat_tools_posts.go to keep this
// file under the 350-line cap.

// runRead —— 按 path 查 entry，ACL 通过 + show_as_source 不抑制时进 collector。
func (r *retriever) runRead(input []byte) (string, error) {
	path, perr := parseReadPath(input)
	if perr != nil {
		return "", perr
	}
	if pathDenied := r.checkReadPath(path); pathDenied != "" {
		return pathDenied, nil
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

// checkReadPath —— pre-check：空 path / denied path 返 err JSON；ok 时返 ""。
func (r *retriever) checkReadPath(path string) string {
	if path == "" {
		return errJSON("path required")
	}
	if !r.acl.AllowsPath(path) {
		return errJSON("access denied: " + path)
	}
	return ""
}

func (r *retriever) dispatchRead(path string) string {
	if w := r.findWikiByPath(path); w != nil {
		r.collector.addWiki(w)
		return marshalKindBody("wiki", w.Body)
	}
	if o := r.findOutputByPath(path); o != nil {
		r.collector.addOutput(o)
		return marshalKindBody("output", o.Body)
	}
	if p := r.findPostByPath(path); p != nil {
		return marshalKindBody("post", postBodyText(p))
	}
	return errJSON("not found: " + path)
}

func (r *retriever) findWikiByPath(path string) *domain.WikiEntry {
	for i := range r.wikis {
		if wikiPath(&r.wikis[i]) == path {
			return &r.wikis[i]
		}
	}
	return nil
}

func (r *retriever) findOutputByPath(path string) *domain.OutputEntry {
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
	out := make([]corpusRow, 0, len(r.wikis)+len(r.outputs)+len(r.posts))
	out = append(out, r.listOutputsByPrefix(prefix)...)
	out = append(out, r.listWikisByPrefix(prefix)...)
	out = append(out, r.listPostsByPrefix(prefix)...)
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

func (r *retriever) listPostsByPrefix(prefix string) []corpusRow {
	out := make([]corpusRow, 0, len(r.posts))
	for i := range r.posts {
		if row, ok := r.listPostRow(&r.posts[i], prefix); ok {
			out = append(out, row)
		}
	}
	return out
}

func (r *retriever) listWikiRow(w *domain.WikiEntry, prefix string) (corpusRow, bool) {
	p := pathOrEmpty(w.Path)
	if !r.acl.AllowsEntry(p) || !strings.HasPrefix(p, prefix) {
		return corpusRow{}, false
	}
	return corpusRow{Path: p, Title: w.Title, Kind: "wiki"}, true
}

func (r *retriever) listOutputRow(o *domain.OutputEntry, prefix string) (corpusRow, bool) {
	p := pathOrEmpty(o.Path)
	if !r.acl.AllowsEntry(p) || !strings.HasPrefix(p, prefix) {
		return corpusRow{}, false
	}
	return corpusRow{Path: p, Title: o.Title, Kind: "output"}, true
}

func pathOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
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

func marshalKindBody(kind, body string) string {
	out, err := json.Marshal(map[string]string{"kind": kind, "body": body})
	if err != nil {
		return errJSON("marshal failed")
	}
	return string(out)
}
