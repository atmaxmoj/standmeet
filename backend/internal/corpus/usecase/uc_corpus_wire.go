// uc_corpus_wire.go —— corpus 检索 op 的 wire 形与 marshal 兜底(#157)。socket handler
// (uc_corpus_index_socket.go)返回都是 JSON string;集中 marshal + 失败兜底。

package usecase

import "encoding/json"

func errJSON(msg string) string {
	out, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		return `{"error":"marshal failed"}`
	}
	return string(out)
}

func marshalRows(rows []Row) string {
	out, err := json.Marshal(rows)
	if err != nil {
		return errJSON("marshal failed")
	}
	return string(out)
}

// readResultWire —— corpus_read 的 wire 形。id(稳定标识)+ genre + body(markdown) +
// path(树派生地址)+ title;css_classes = per-note 呈现钩子。
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
