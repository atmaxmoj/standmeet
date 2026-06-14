// visitor_chat_tools_wiki.go —— retriever 的 corpus_search 匹配 helpers。wiki +
// output 都走 DB 全量搜(Search,full-text,不吃内存 50-cap):每命中顺 parent_id 上溯
// 算树派生 path + ACL,把 path→id 记进 seen/outputSeen 供 corpus_read 反查。
// 从 visitor_chat_tools.go 拆出来守 350-line cap。

package usecases

import (
	"context"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// matchWikis —— wiki 走 DB 全量搜,不吃内存 50。
func (r *retriever) matchWikis(ctx context.Context, q string) []corpusRow {
	hits, err := r.wikiRepo.Search(ctx, r.ownerID, q, searchPageLimit, 0)
	if err != nil {
		return []corpusRow{}
	}
	out := make([]corpusRow, 0, len(hits))
	for i := range hits {
		if row, ok := r.wikiHitToRow(ctx, &hits[i]); ok {
			out = append(out, row)
		}
	}
	return out
}

func (r *retriever) wikiHitToRow(ctx context.Context, h *postgres.WikiMeta) (corpusRow, bool) {
	path, perr := wikiPathByID(ctx, r.wikiRepo, r.ownerID, h.ID)
	if perr != nil || !r.allowsPath(domain.GenreWiki, path) {
		return corpusRow{}, false
	}
	r.seen[path] = h.ID
	return corpusRow{Path: path, Title: h.Title, Genre: "wiki", Summary: summarize(h.Snippet)}, true
}

// matchOutputs —— output 走 DB 全量搜(wiki 孪生),不吃内存 50。
func (r *retriever) matchOutputs(ctx context.Context, q string) []corpusRow {
	hits, err := r.outputRepo.Search(ctx, r.ownerID, q, searchPageLimit, 0)
	if err != nil {
		return []corpusRow{}
	}
	out := make([]corpusRow, 0, len(hits))
	for i := range hits {
		if row, ok := r.outputHitToRow(ctx, &hits[i]); ok {
			out = append(out, row)
		}
	}
	return out
}

func (r *retriever) outputHitToRow(ctx context.Context, h *postgres.OutputMeta) (corpusRow, bool) {
	path, perr := outputPathByID(ctx, r.outputRepo, r.ownerID, h.ID)
	if perr != nil || !r.allowsPath(domain.GenreOutput, path) {
		return corpusRow{}, false
	}
	r.outputSeen[path] = h.ID
	return corpusRow{
		Path: path, Title: h.Title, Genre: "output", Summary: summarize(h.Snippet),
	}, true
}

func summarize(body string) string {
	trimmed := strings.TrimSpace(body)
	if len(trimmed) <= summaryMaxChars {
		return trimmed
	}
	return trimmed[:summaryMaxChars] + "…"
}
