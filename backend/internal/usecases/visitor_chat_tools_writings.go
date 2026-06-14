// visitor_chat_tools_writings.go —— retriever 的 writing-specific 辅助。writing 跟
// wiki/output 对称:corpus_search 走 DB 全量搜(Search)、corpus_read 走 DB 按 path 读
// (GetPublishedByPath,published 准入),不走内存窗口。corpus_list 仍用内存 r.writings
// (扁平 genre,同 output)。cited footer 不收 writing(自带 cross_refs + "ask about
// this essay" 入口)。

package usecases

import (
	"context"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// matchWritings —— writing 走 DB 全量搜(wiki/output 孪生),published 已在 SQL 滤;
// 再按 path 评 ACL。
func (r *retriever) matchWritings(ctx context.Context, q string) []corpusRow {
	hits, err := r.writingRepo.Search(ctx, r.ownerID, q, searchPageLimit, 0)
	if err != nil {
		return []corpusRow{}
	}
	out := make([]corpusRow, 0, len(hits))
	for i := range hits {
		if r.allowsEntry(domain.GenreWriting, hits[i].Path()) {
			out = append(out, writingToRow(&hits[i]))
		}
	}
	return out
}

// findWritingByPath —— DB 按 path 读 published writing(不走内存)。ACL 留给
// readWritingIfAllowed/pathExistsAnyGenre,这里只解析存在性。
func (r *retriever) findWritingByPath(ctx context.Context, path string) *domain.Writing {
	w, err := r.writingRepo.GetPublishedByPath(ctx, r.ownerID, path)
	if err != nil {
		return nil
	}
	return &w
}

func writingBodyText(w *domain.Writing) string {
	return StripMarkdown(w.Body())
}

func (r *retriever) listWritingRow(w *domain.Writing, prefix string) (corpusRow, bool) {
	p := w.Path()
	if !r.allowsEntry(domain.GenreWriting, p) || !strings.HasPrefix(p, prefix) {
		return corpusRow{}, false
	}
	return corpusRow{Path: p, Title: w.Title(), Genre: "writing"}, true
}

func writingToRow(w *domain.Writing) corpusRow {
	return corpusRow{
		Path: w.Path(), Title: w.Title(), Genre: "writing",
		Summary: writingRowSummary(w),
	}
}

func writingRowSummary(w *domain.Writing) string {
	if w.Excerpt() != "" {
		return summarize(w.Excerpt())
	}
	return summarize(writingBodyText(w))
}
