// corpus_views.go —— domain.* → admin list 视图 item 的转换器。
// 从 corpus_crud.go 拆出来守 350 行 max-lines。
//
// 前端 admin list 全部按 snake_case + 空 slice = [] 期望读；不能直接
// 序列化 domain.RawEntry / WikiEntry / OutputEntry（无 JSON tag）。

package admin

import (
	"github.com/wangsijie/standmeet/internal/domain"
)

func rawItemFromDomain(r *domain.RawEntry) rawListItem {
	return rawListItem{
		ID:        r.ID,
		Body:      r.Body,
		Source:    r.Source,
		Tags:      ensureSlice(r.Tags),
		CreatedAt: r.CreatedAt.UTC().Format(timeRFC3339),
	}
}

func wikiItemFromDomain(w *domain.WikiEntry) wikiListItem {
	return wikiListItem{
		ID:           w.ID,
		Title:        w.Title,
		Visibility:   w.Visibility,
		Tags:         ensureSlice(w.Tags),
		SourceRawIDs: ensureSlice(w.SourceRawIDs),
		ParentID:     w.ParentID,
		SEOSlug:      w.SEOSlug,
		SEOIndexed:   w.SEOIndexed,
		CreatedAt:    w.CreatedAt.UTC().Format(timeRFC3339),
	}
}

func outputItemFromDomain(o *domain.OutputEntry) outputListItem {
	return outputListItem{
		ID:            o.ID,
		Title:         o.Title,
		Visibility:    o.Visibility,
		Tags:          ensureSlice(o.Tags),
		SourceWikiIDs: ensureSlice(o.SourceWikiIDs),
		ParentID:      o.ParentID,
		SEOSlug:       o.SEOSlug,
		SEOIndexed:    o.SEOIndexed,
		CreatedAt:     o.CreatedAt.UTC().Format(timeRFC3339),
	}
}

func ensureSlice(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
