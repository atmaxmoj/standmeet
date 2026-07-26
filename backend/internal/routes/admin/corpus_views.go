// corpus_views.go —— domain.* → admin list 视图 item 的转换器。
// 前端 admin list 全部按 snake_case + 空 slice = [] 期望读。

package admin

import (
	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func rawItemFromDomain(r *corpus.Raw) rawListItem {
	return rawListItem{
		ID:        r.ID(),
		Body:      r.Body(),
		Preview:   usecases.LeadLine(r.Body(), excerptMaxLen), // F-R-1: clean excerpt
		Source:    r.Source(),
		Tags:      ensureSlice(r.Tags()),
		CreatedAt: r.CreatedAt().UTC().Format(timeRFC3339),
	}
}

// wikiItemFromDomain —— path 由 caller 传(树派生地址,纯从 parent 链算,不读
// 已退役的 path 列);单条上下文(promote 结果)没全树可算就传 ""。
func wikiItemFromDomain(w *corpus.Wiki, path string) wikiListItem {
	return wikiListItem{
		ID:    w.ID(),
		Title: w.Title(),
		// Excerpt is the SEPARATE authored field (may be empty); Preview is a body-derived
		// fallback the card shows only when Excerpt is empty — the truncation is never the
		// excerpt itself.
		Excerpt:      w.Excerpt(),
		Preview:      usecases.LeadLine(w.Body(), excerptMaxLen), // clean lead (F-R-2)
		Tags:         ensureSlice(w.Tags()),
		SourceRawIDs: ensureSlice(w.SourceRawIDs()),
		ParentID:     optionalToPtr(w.ParentID),
		Path:         ptrIfNonEmpty(path),
		ShowAsSource: w.ShowAsSource(),
		Published:    w.Published(),
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

func outputItemFromDomain(o *corpus.Output, path string) outputListItem {
	return outputListItem{
		ID:            o.ID(),
		Title:         o.Title(),
		Tags:          ensureSlice(o.Tags()),
		SourceWikiIDs: ensureSlice(o.SourceWikiIDs()),
		ParentID:      optionalToPtr(o.ParentID),
		Path:          ptrIfNonEmpty(path),
		ShowAsSource:  o.ShowAsSource(),
		Published:     o.Published(),
		CreatedAt:     o.CreatedAt().UTC().Format(timeRFC3339),
	}
}

func ensureSlice(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
