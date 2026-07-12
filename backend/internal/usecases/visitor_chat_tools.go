// visitor_chat_tools.go —— corpus retrieval WIRE helpers (#157). The retriever engine
// moved into pgCorpusLister (corpus_lister_pg*.go); what remains here is the tool result
// wire format shared by the socket op handlers (corpus_search/read/list) and the summary
// truncation. tool name / schema / desc are declared by the external retrieval plugin
// (mcp-servers/retrieval); this file owns only the JSON shapes those ops return.

package usecases

import (
	"encoding/json"
	"strings"
)

// summaryMaxChars —— corpus_search 摘要截断上限。
const summaryMaxChars = 160

// corpusRow —— corpus_search / corpus_list 的 wire 行。summary 仅 search 填(omitempty)。
type corpusRow struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Genre   string `json:"genre"`
	Summary string `json:"summary,omitempty"`
}

// summarize —— 截断到 summaryMaxChars，给 corpus_search 摘要 / writing 行摘要用。
func summarize(body string) string {
	trimmed := strings.TrimSpace(body)
	if len(trimmed) <= summaryMaxChars {
		return trimmed
	}
	return trimmed[:summaryMaxChars] + "…"
}

// errJSON / marshalRows / marshalReadResult —— tool 返回都是 JSON string;集中 marshal +
// 失败兜底，避免散落 errcheck 告警。
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

// marshalReadResult —— corpus_read 的 wire:id(稳定标识,admin transcript 记 cited_*_ids)
// + genre + body(markdown) + path(树派生地址) + title。前端 pi-agent-core 收到后累积
// citations(id 落库 / genre+path+title 给 UI / body 给展开)。
// readResultWire —— corpus_read 的 wire 形。css_classes = per-note 呈现钩子。
type readResultWire struct {
	ID           string   `json:"id"`
	Genre        string   `json:"genre"`
	Body         string   `json:"body"`
	Path         string   `json:"path"`
	Title        string   `json:"title"`
	CSSClasses   []string `json:"css_classes"`
	ShowAsSource bool     `json:"show_as_source"`
}

func marshalReadResult(r *readResultWire) string {
	if r.CSSClasses == nil {
		r.CSSClasses = []string{}
	}
	out, err := json.Marshal(r)
	if err != nil {
		return errJSON("marshal failed")
	}
	return string(out)
}
