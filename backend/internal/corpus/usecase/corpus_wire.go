// corpus_wire.go —— corpus 检索 op 的 wire 形与 marshal 兜底(#157)。socket handler
// (corpus_index_socket.go)返回都是 JSON string;集中 marshal + 失败兜底。

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
	// 素材 —— 这条语料身上的图 / 附件,以及正文里那些引用解析出的地址。
	AssetURLs map[string]string `json:"asset_urls,omitempty"`
	ID        string            `json:"id"`
	Genre     string            `json:"genre"`
	Body      string            `json:"body"`
	Path      string            `json:"path"`
	// Slug —— writings 才有。公开站按 slug 寻址一条 writing（`/writings/<slug>`），而 Path
	// 是它在树里的位置（`writings/<slug>`）。少了它，引用方只能拿 Path 拼，拼出来是 404。
	Slug  string `json:"slug,omitempty"`
	Title string `json:"title"`
	// Lang / Languages —— 这份正文是哪一种语言,以及这条笔记还有哪些语言可读。
	// 后者一定要给:不然 agent 连"有别的语言"都不知道,也就谈不上自己决定读哪种。
	// 单语笔记:Lang 空、Languages 空数组。
	Lang         string      `json:"lang,omitempty"`
	Languages    []string    `json:"languages"`
	CSSClasses   []string    `json:"css_classes"`
	Assets       []AssetView `json:"assets,omitempty"`
	ShowAsSource bool        `json:"show_as_source"`
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
