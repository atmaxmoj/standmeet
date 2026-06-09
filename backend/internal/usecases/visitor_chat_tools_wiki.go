// visitor_chat_tools_wiki.go —— retriever 的 wiki/output 匹配 helpers。
// 从 visitor_chat_tools.go 拆出来守 350-line cap。

package usecases

import (
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

func (r *retriever) wikiMatches(w *domain.Wiki, q string) bool {
	return r.allowsEntry(domain.GenreWiki, r.wikiPath(w)) &&
		textMatchesQuery(q, w.Title(), w.Body(), w.Tags())
}

func (r *retriever) outputMatches(o *domain.Output, q string) bool {
	return r.allowsEntry(domain.GenreOutput, r.outputPath(o)) &&
		textMatchesQuery(q, o.Title(), o.Body(), o.Tags())
}

func (r *retriever) wikiToRow(w *domain.Wiki) corpusRow {
	return corpusRow{
		Path: r.wikiPath(w), Title: w.Title(), Genre: "wiki",
		Summary: summarize(w.Body()),
	}
}

func (r *retriever) outputToRow(o *domain.Output) corpusRow {
	return corpusRow{
		Path: r.outputPath(o), Title: o.Title(), Genre: "output",
		Summary: summarize(o.Body()),
	}
}

func summarize(body string) string {
	trimmed := strings.TrimSpace(body)
	if len(trimmed) <= summaryMaxChars {
		return trimmed
	}
	return trimmed[:summaryMaxChars] + "…"
}
