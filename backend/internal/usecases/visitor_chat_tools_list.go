// visitor_chat_tools_list.go —— corpus_list tool 的执行体。从 visitor_chat_tools.go
// 拆出来守 max-lines 350 cap。按 prefix filter 内存窗口里的 wiki/output/writing,
// 返 path/title/genre(meta-only,不含 body)。
//
// 注:list 仍走内存窗口(r.wikis/outputs/writings);全量懒导航(树状向下翻页)的
// DB 版另起,见 retriever 的 search/read DB 路径。

package usecases

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

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
	p := r.wikiPath(w)
	if !r.allowsEntry(domain.GenreWiki, p) || !strings.HasPrefix(p, prefix) {
		return corpusRow{}, false
	}
	return corpusRow{Path: p, Title: w.Title(), Genre: "wiki"}, true
}

func (r *retriever) listOutputRow(o *domain.Output, prefix string) (corpusRow, bool) {
	p := r.outputPath(o)
	if !r.allowsEntry(domain.GenreOutput, p) || !strings.HasPrefix(p, prefix) {
		return corpusRow{}, false
	}
	return corpusRow{Path: p, Title: o.Title(), Genre: "output"}, true
}
