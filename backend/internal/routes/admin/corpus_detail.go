// corpus_detail.go —— GET /api/admin/{raw,wiki,output}/{id} 单条详情。
// 列表 item 不含 body（payload 小）；编辑前前端 fetch 详情拿 body 回填。
//
// detail view item 比 list item 多 body / source_*_ids 字段。raw 已经在
// list 里带 body 了，所以 raw 的 detail 视图 == rawListItem。

package admin

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
)

type wikiDetailItem struct {
	ParentID       *string  `json:"parent_id"`
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Body           string   `json:"body"`
	Visibility     string   `json:"visibility"`
	SEODescription string   `json:"seo_description"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
	Tags           []string `json:"tags"`
	SourceRawIDs   []string `json:"source_raw_ids"`
}

type outputDetailItem struct {
	ParentID       *string  `json:"parent_id"`
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Body           string   `json:"body"`
	Visibility     string   `json:"visibility"`
	SEODescription string   `json:"seo_description"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
	Tags           []string `json:"tags"`
	SourceWikiIDs  []string `json:"source_wiki_ids"`
}

func wikiDetailFromDomain(w *domain.WikiEntry) wikiDetailItem {
	return wikiDetailItem{
		ID: w.ID, Title: w.Title, Body: w.Body, Visibility: w.Visibility,
		Tags: ensureSlice(w.Tags), SourceRawIDs: ensureSlice(w.SourceRawIDs),
		ParentID: w.ParentID, SEODescription: w.SEODescription,
		CreatedAt: w.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt: w.UpdatedAt.UTC().Format(timeRFC3339),
	}
}

func outputDetailFromDomain(o *domain.OutputEntry) outputDetailItem {
	return outputDetailItem{
		ID: o.ID, Title: o.Title, Body: o.Body, Visibility: o.Visibility,
		Tags: ensureSlice(o.Tags), SourceWikiIDs: ensureSlice(o.SourceWikiIDs),
		ParentID: o.ParentID, SEODescription: o.SEODescription,
		CreatedAt: o.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt: o.UpdatedAt.UTC().Format(timeRFC3339),
	}
}

func (h *Handlers) getRaw() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		row, err := h.Corpus.Corpus.Raw.GetByID(r.Context(), ownerID, chi.URLParam(r, "id"))
		writeCorpusResult(h.Log, w, rawItemFromDomain(&row), translateGetErr(err), "get raw")
	}
}

func (h *Handlers) getWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		row, err := h.Corpus.Corpus.Wiki.GetByID(r.Context(), ownerID, chi.URLParam(r, "id"))
		writeCorpusResult(h.Log, w, wikiDetailFromDomain(&row), translateGetErr(err), "get wiki")
	}
}

func (h *Handlers) getOutput() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		row, err := h.Corpus.Corpus.Output.GetByID(r.Context(), ownerID, chi.URLParam(r, "id"))
		item := outputDetailFromDomain(&row)
		writeCorpusResult(h.Log, w, item, translateGetErr(err), "get output")
	}
}

// translateGetErr —— pass-through；NotFound sentinel 已被 corpusErrCases
// 映射成 404 envelope，pass-through 让 caller 不用各自分支。
func translateGetErr(err error) error { return err }

// keep errors import in use for future extension; cur. translate is a no-op.
var _ = errors.Is
