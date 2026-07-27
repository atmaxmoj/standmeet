// corpus_detail.go —— GET /api/admin/{raw,wiki,output}/{id} 单条详情。
// 列表 item 不含 body（payload 小）；编辑前前端 fetch 详情拿 body 回填。

package admin

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

// detail 不含 path:地址树派生(浏览列表那条由 corpus.WikiTreePaths 算并回显);
// 编辑表单不再有可改的 path 字段(owner 不能自设地址)。
// refView —— 一条 note_ref 边端点（id + title），给 admin 详情的 outbound/backlinks 用。
type refView struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type wikiDetailItem struct {
	ParentID     *string   `json:"parent_id"`
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Body         string    `json:"body"`
	Excerpt      string    `json:"excerpt"`
	CreatedAt    string    `json:"created_at"`
	UpdatedAt    string    `json:"updated_at"`
	Tags         []string  `json:"tags"`
	SourceRawIDs []string  `json:"source_raw_ids"`
	Outbound     []refView `json:"outbound"`
	Backlinks    []refView `json:"backlinks"`
	ShowAsSource bool      `json:"show_as_source"`
	Published    bool      `json:"published"`
}

type outputDetailItem struct {
	ParentID      *string   `json:"parent_id"`
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Body          string    `json:"body"`
	Excerpt       string    `json:"excerpt"`
	CreatedAt     string    `json:"created_at"`
	UpdatedAt     string    `json:"updated_at"`
	Tags          []string  `json:"tags"`
	SourceWikiIDs []string  `json:"source_wiki_ids"`
	Outbound      []refView `json:"outbound"`
	Backlinks     []refView `json:"backlinks"`
	ShowAsSource  bool      `json:"show_as_source"`
	Published     bool      `json:"published"`
}

func wikiDetailFromDomain(w *corpus.Wiki) wikiDetailItem {
	return wikiDetailItem{
		ID: w.ID(), Title: w.Title(), Body: w.Body(),
		Tags: ensureSlice(w.Tags()), SourceRawIDs: ensureSlice(w.SourceRawIDs()),
		ParentID: optionalToPtr(w.ParentID), Excerpt: w.Excerpt(),
		ShowAsSource: w.ShowAsSource(), Published: w.Published(),
		CreatedAt: w.CreatedAt().UTC().Format(timeRFC3339),
		UpdatedAt: w.UpdatedAt().UTC().Format(timeRFC3339),
	}
}

func outputDetailFromDomain(o *corpus.Output) outputDetailItem {
	return outputDetailItem{
		ID: o.ID(), Title: o.Title(), Body: o.Body(),
		Tags: ensureSlice(o.Tags()), SourceWikiIDs: ensureSlice(o.SourceWikiIDs()),
		ParentID: optionalToPtr(o.ParentID), Excerpt: o.Excerpt(),
		ShowAsSource: o.ShowAsSource(), Published: o.Published(),
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
		id := chi.URLParam(r, "id")
		row, err := h.Corpus.Corpus.Wiki.GetByID(r.Context(), ownerID, id)
		item := wikiDetailFromDomain(&row)
		if err == nil {
			refs := h.noteRefViews(r.Context(), ownerID, id)
			item.Outbound, item.Backlinks = refs.Outbound, refs.Backlinks
		}
		writeCorpusResult(h.Log, w, item, translateGetErr(err), "get wiki")
	}
}

func (h *Handlers) getOutput() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		id := chi.URLParam(r, "id")
		row, err := h.Corpus.Corpus.Output.GetByID(r.Context(), ownerID, id)
		item := outputDetailFromDomain(&row)
		if err == nil {
			refs := h.noteRefViews(r.Context(), ownerID, id)
			item.Outbound, item.Backlinks = refs.Outbound, refs.Backlinks
		}
		writeCorpusResult(h.Log, w, item, translateGetErr(err), "get output")
	}
}

// noteRefsView —— owner 视角的 read-next（outbound）+ cited-by（backlinks）。
type noteRefsView struct {
	Outbound  []refView
	Backlinks []refView
}

// noteRefViews —— 取一条 note 的 outbound/backlinks 边（任一 genre、含未发布）。best-effort：出错
// 记日志、返空（详情主体仍可用）。
func (h *Handlers) noteRefViews(ctx context.Context, ownerID, id string) noteRefsView {
	outbound, oerr := h.Corpus.Corpus.NoteRefs.AdminOutboundFor(ctx, ownerID, id)
	backlinks, berr := h.Corpus.Corpus.NoteRefs.AdminBacklinksFor(ctx, ownerID, id)
	if oerr != nil || berr != nil {
		h.Log.Error("admin note refs", "err", errors.Join(oerr, berr))
	}
	return noteRefsView{
		Outbound: noteRefsToViews(outbound), Backlinks: noteRefsToViews(backlinks),
	}
}

func noteRefsToViews(refs []corpus.NoteRef) []refView {
	out := make([]refView, 0, len(refs))
	for i := range refs {
		out = append(out, refView{ID: refs[i].ID, Title: refs[i].Title})
	}
	return out
}

func translateGetErr(err error) error { return err }

var _ = errors.Is
