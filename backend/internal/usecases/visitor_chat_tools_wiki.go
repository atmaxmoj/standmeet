// visitor_chat_tools_wiki.go —— retriever 的 wiki/output 匹配 helpers。
// 从 visitor_chat_tools.go 拆出来守 350-line cap。

package usecases

import (
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// wiki 匹配/转行已切到 DB 全量搜(retriever.matchWikis → wikiRepo.Search +
// wikiHitToRow),不再走内存窗口的 wikiMatches/wikiToRow。output/writing 仍内存。

func (r *retriever) outputMatches(o *domain.Output, q string) bool {
	return r.allowsEntry(domain.GenreOutput, r.outputPath(o)) &&
		textMatchesQuery(q, o.Title(), o.Body(), o.Tags())
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
