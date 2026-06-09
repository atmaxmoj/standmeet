// corpus_views.go —— domain.* → admin list 视图 item 的转换器。
// 前端 admin list 全部按 snake_case + 空 slice = [] 期望读。

package admin

import (
	"github.com/atmaxmoj/standmeet/internal/domain"
)

func rawItemFromDomain(r *domain.Raw) rawListItem {
	return rawListItem{
		ID:        r.ID(),
		Body:      r.Body(),
		Source:    r.Source(),
		Tags:      ensureSlice(r.Tags()),
		CreatedAt: r.CreatedAt().UTC().Format(timeRFC3339),
	}
}

// wikiItemFromDomain —— path 由 caller 传(树派生地址,纯从 parent 链算,不读
// 已退役的 path 列);单条上下文(promote 结果)没全树可算就传 ""。
func wikiItemFromDomain(w *domain.Wiki, path string) wikiListItem {
	return wikiListItem{
		ID:           w.ID(),
		Title:        w.Title(),
		Excerpt:      truncateExcerpt(w.Body(), excerptMaxLen),
		Tags:         ensureSlice(w.Tags()),
		SourceRawIDs: ensureSlice(w.SourceRawIDs()),
		ParentID:     optionalToPtr(w.ParentID),
		Path:         ptrIfNonEmpty(path),
		ShowAsSource: w.ShowAsSource(),
		SEOIndexed:   w.SEOIndexed(),
		CreatedAt:    w.CreatedAt().UTC().Format(timeRFC3339),
	}
}

// ptrIfNonEmpty —— 空串 → nil(JSON null / 省略),非空 → 指针。
func ptrIfNonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

const excerptMaxLen = 200

func truncateExcerpt(body string, limit int) string {
	if len(body) <= limit {
		return body
	}
	return body[:limit] + "…"
}

func outputItemFromDomain(o *domain.Output, path string) outputListItem {
	return outputListItem{
		ID:            o.ID(),
		Title:         o.Title(),
		Tags:          ensureSlice(o.Tags()),
		SourceWikiIDs: ensureSlice(o.SourceWikiIDs()),
		ParentID:      optionalToPtr(o.ParentID),
		Path:          ptrIfNonEmpty(path),
		ShowAsSource:  o.ShowAsSource(),
		SEOIndexed:    o.SEOIndexed(),
		CreatedAt:     o.CreatedAt().UTC().Format(timeRFC3339),
	}
}

func ensureSlice(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
