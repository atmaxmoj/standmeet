// visitor_chat_tools_writings.go —— retriever 的 writing-specific 辅助。从
// visitor_chat_tools.go 拆出来守 350-line cap。writings 跟 wiki/output 共享
// search/read/list；cited footer 不收 writing (writing 有自己的 cross_refs +
// "ask about this essay" 入口)。

package usecases

import (
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
)

func (r *retriever) writingMatches(w *domain.Writing, q string) bool {
	return r.acl.AllowsEntry(w.Path()) &&
		textMatchesQuery(q, w.Title(), writingBodyText(w), w.Tags())
}

func writingBodyText(w *domain.Writing) string {
	return StripMarkdown(w.Body())
}

func (r *retriever) listWritingRow(w *domain.Writing, prefix string) (corpusRow, bool) {
	p := w.Path()
	if !r.acl.AllowsEntry(p) || !strings.HasPrefix(p, prefix) {
		return corpusRow{}, false
	}
	return corpusRow{Path: p, Title: w.Title(), Kind: "writing"}, true
}

func (r *retriever) findWritingByPath(path string) *domain.Writing {
	for i := range r.writings {
		if r.writings[i].Path() == path {
			return &r.writings[i]
		}
	}
	return nil
}

func writingToRow(w *domain.Writing) corpusRow {
	return corpusRow{
		Path: w.Path(), Title: w.Title(), Kind: "writing",
		Summary: writingRowSummary(w),
	}
}

func writingRowSummary(w *domain.Writing) string {
	if w.Excerpt() != "" {
		return summarize(w.Excerpt())
	}
	return summarize(writingBodyText(w))
}
