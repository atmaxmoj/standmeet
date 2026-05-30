// corpus_detail.go —— GET /api/admin/{raw,wiki,output}/{id} 单条详情。
// 列表 item 不含 body（payload 小）；编辑前前端 fetch 详情拿 body 回填。

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
	Path           *string  `json:"path"`
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Body           string   `json:"body"`
	SEODescription string   `json:"seo_description"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
	Tags           []string `json:"tags"`
	SourceRawIDs   []string `json:"source_raw_ids"`
	ShowAsSource   bool     `json:"show_as_source"`
	SEOIndexed     bool     `json:"seo_indexed"`
}

type outputDetailItem struct {
	ParentID       *string  `json:"parent_id"`
	Path           *string  `json:"path"`
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Body           string   `json:"body"`
	SEODescription string   `json:"seo_description"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
	Tags           []string `json:"tags"`
	SourceWikiIDs  []string `json:"source_wiki_ids"`
	ShowAsSource   bool     `json:"show_as_source"`
	SEOIndexed     bool     `json:"seo_indexed"`
}

func wikiDetailFromDomain(w *domain.Wiki) wikiDetailItem {
	return wikiDetailItem{
		ID: w.ID(), Title: w.Title(), Body: w.Body(),
		Tags: ensureSlice(w.Tags()), SourceRawIDs: ensureSlice(w.SourceRawIDs()),
		ParentID: optionalToPtr(w.ParentID), SEODescription: w.SEODescription(),
		Path: optionalToPtr(w.Path), ShowAsSource: w.ShowAsSource(), SEOIndexed: w.SEOIndexed(),
		CreatedAt: w.CreatedAt().UTC().Format(timeRFC3339),
		UpdatedAt: w.UpdatedAt().UTC().Format(timeRFC3339),
	}
}

func outputDetailFromDomain(o *domain.Output) outputDetailItem {
	return outputDetailItem{
		ID: o.ID(), Title: o.Title(), Body: o.Body(),
		Tags: ensureSlice(o.Tags()), SourceWikiIDs: ensureSlice(o.SourceWikiIDs()),
		ParentID: optionalToPtr(o.ParentID), SEODescription: o.SEODescription(),
		Path: optionalToPtr(o.Path), ShowAsSource: o.ShowAsSource(), SEOIndexed: o.SEOIndexed(),
		CreatedAt: o.CreatedAt().UTC().Format(timeRFC3339),
		UpdatedAt: o.UpdatedAt().UTC().Format(timeRFC3339),
	}
}

// optionalToPtr —— domain (string, bool) getter (例 wiki.Path / ParentID) →
// *string，给 JSON marshal 当 omitempty *string 字段用。
//
// closure 入参形态：caller 传方法引用 (`w.Path`) 而不是 `w.Path()`，让 helper
// 内部统一 deref。这样 optionalToPtr 的签名是 (func) 而不是 (string, bool)，
// 避开 revive flag-parameter 对 Optional<string> 的 ok 部分的误判。
func optionalToPtr(get func() (string, bool)) *string {
	v, ok := get()
	if !ok {
		return nil
	}
	cp := v
	return &cp
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

func translateGetErr(err error) error { return err }

var _ = errors.Is
