// writings.go —— public GET /api/v1/writings (lists published articles) + GET
// /api/v1/writings/{slug} (article detail; a private article respects visibility —
// the backend does no code authentication at this layer: the frontend renders a
// LockedView when it sees visibility=private, and actually unlocking it needs
// ?c=CODE through a visitor session).
//
// The owner is resolved implicitly by handle (v1 is a single-owner instance; fetched
// from page deps' LoadSoleOwner).

package public

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// WritingHandlers —— the public writings endpoints.
type WritingHandlers struct {
	Writings  corpus.WritingsDeps
	CrossLink corpus.CrossLinkQueryDeps
	Page      owner.PageDeps
	Assets    corpus.AssetsDeps
	Log       *slog.Logger
}

// backlinkView —— used by /writings/<slug>'s "linked from".
type backlinkView struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

type writingView struct {
	PublishedAt       string            `json:"published_at,omitempty"`
	CoverImageAssetID string            `json:"cover_image_asset_id,omitempty"`
	ID                string            `json:"id"`
	Slug              string            `json:"slug"`
	Title             string            `json:"title"`
	Excerpt           string            `json:"excerpt"`
	BodyMD            string            `json:"body_md"`
	CoverHeadline     string            `json:"cover_headline"`
	CoverHue          string            `json:"cover_hue"`
	Visibility        string            `json:"visibility"`
	Path              string            `json:"path"`
	LockedBody        string            `json:"locked_body,omitempty"`
	AssetURLs         map[string]string `json:"asset_urls"`
	// Lang / Languages —— which language this body is in, and which languages this
	// entry offers (used by the switcher). Same shape as the landing path's
	// (`languageView`), so the reader page shares one `LanguageSwitch`.
	// Single-language: lang empty, languages an empty array — **never null**, a
	// null would be read as "this field is broken".
	Lang        string         `json:"lang"`
	Languages   []languageView `json:"languages"`
	Tags        []string       `json:"tags"`
	CrossRefs   []string       `json:"cross_refs"`
	Backlinks   []backlinkView `json:"backlinks,omitempty"`
	ReadMinutes int32          `json:"read_minutes"`
}

type writingsPageResp struct {
	NextCursor string        `json:"next_cursor,omitempty"`
	Writings   []writingView `json:"writings"`
}

// Mount wires /writings.
func (h *WritingHandlers) Mount(r chi.Router) {
	r.Get("/writings", h.list())
	// writing-tree —— lazy-loaded hierarchy + node context for the reader sidebar
	// (writing_tree.go).
	r.Get("/writing-tree", h.getWritingTree())
	r.Get("/writing-tree/context", h.getWritingTreeContext())
	r.Get("/writings/{slug}", h.get())
}

func (h *WritingHandlers) list() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		soleOwner, err := owner.LoadSoleOwner(r.Context(), h.Page)
		if err != nil {
			h.handleWritingErr(w, "load owner", err)
			return
		}
		runListWritingsPage(r, h, w, soleOwner.ID)
	}
}

func runListWritingsPage(
	r *http.Request, h *WritingHandlers, w http.ResponseWriter, ownerID string,
) {
	in := parseWritingsPageQuery(r, ownerID)
	page, err := corpus.ListPublishedWritingsPage(r.Context(), h.Writings, in)
	if err != nil {
		h.handleWritingErr(w, "list writings page", err)
		return
	}
	writeWritingsPage(r, h, w, &page)
}

func parseWritingsPageQuery(
	r *http.Request, ownerID string,
) *corpus.ListPublishedWritingsPageInput {
	q := r.URL.Query()
	in := &corpus.ListPublishedWritingsPageInput{
		OwnerID: ownerID, Limit: int32(parseIntOr(q.Get("limit"), 0)),
	}
	if c := q.Get("cursor"); c != "" {
		if t, terr := time.Parse(time.RFC3339, c); terr == nil {
			in.Cursor = &t
		}
	}
	return in
}

func parseIntOr(s string, fallback int) int {
	if s == "" {
		return fallback
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return n
}

func writeWritingsPage(
	r *http.Request, h *WritingHandlers, w http.ResponseWriter,
	page *corpus.ListPublishedWritingsPageResult,
) {
	resp := buildWritingsPageResp(r, h, page)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.Log.Error("encode writings page", logErr, err)
	}
}

func buildWritingsPageResp(
	r *http.Request, h *WritingHandlers, page *corpus.ListPublishedWritingsPageResult,
) writingsPageResp {
	index := loadCrossLinkIndex(r.Context(), h, page)
	items := make([]writingView, 0, len(page.Writings))
	for i := range page.Writings {
		v := toWritingViewResolved(r, h, &page.Writings[i])
		v.BodyMD = corpus.RewriteCrossLinksForRender(v.BodyMD, index)
		items = append(items, v)
	}
	resp := writingsPageResp{Writings: items}
	if page.NextCursor != nil {
		resp.NextCursor = page.NextCursor.Format(time.RFC3339Nano)
	}
	return resp
}

// loadCrossLinkIndex —— pulls the owner's published-writing slug+title table once,
// reused by every writing's body_md rewrite on this page, avoiding N+1. Empty page /
// index failure → empty slice.
func loadCrossLinkIndex(
	ctx context.Context, h *WritingHandlers, page *corpus.ListPublishedWritingsPageResult,
) []corpus.SlugTitle {
	if len(page.Writings) == 0 {
		return []corpus.SlugTitle{}
	}
	index, err := corpus.LoadCrossLinkIndex(ctx, h.CrossLink, page.Writings[0].OwnerID())
	if err != nil {
		h.Log.Error("crosslink slug index (list)", logErr, err)
		return []corpus.SlugTitle{}
	}
	return index
}

func (h *WritingHandlers) get() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		soleOwner, err := owner.LoadSoleOwner(r.Context(), h.Page)
		if err != nil {
			h.handleWritingErr(w, "load owner", err)
			return
		}
		writing, perr := corpus.GetWritingBySlug(r.Context(), h.Writings, soleOwner.ID, slug)
		if perr != nil {
			h.handleWritingErr(w, "get writing", perr)
			return
		}
		writeWritingResp(r, h, w, soleOwner.ID, &writing)
	}
}

func writeWritingResp(
	r *http.Request, h *WritingHandlers, w http.ResponseWriter,
	ownerID string, wg *corpus.Writing,
) {
	view := toWritingViewResolved(r, h, wg)
	view.BodyMD = rewriteBodyWithCrossLinks(r.Context(), h, ownerID, view.BodyMD)
	applyWritingI18n(r, &view)
	view.Backlinks = loadBacklinks(r.Context(), h, ownerID, wg.ID())
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		h.Log.Error("encode writing", logErr, err)
	}
}

// applyWritingI18n —— picks one language's body, **and carries "what other languages
// exist" along with it**.
//
// F-R-6: the previous cut only wired `.Body`, leaving `Lang` / `Languages` stranded in
// the return value, so a reader got the English version with no way to know a Chinese
// one existed — while the wiki reader always had that pair of buttons. Fixing one
// layer exposes the next; an unwired edge stays unwired.
func applyWritingI18n(r *http.Request, view *writingView) {
	got := corpus.I18nViewFor(view.BodyMD, r.URL.Query().Get("lang"), "", view.Title)
	view.BodyMD = got.Body
	view.Lang = got.Lang
	view.Languages = toWritingLanguageViews(got.Languages)
}

// toWritingLanguageViews —— language set → switcher entries. Labels go through the
// same `I18nLabel` as landing, so the vault, landing, and reader all show the same
// wording. labels is passed nil: the writings path doesn't yet have the vault's
// lang-labels (the same gap identity has), so `I18nLabel` falls back to the built-in
// table (zh→中文). **Written down deliberately, so it doesn't quietly become "that's
// just how it works"**.
func toWritingLanguageViews(codes []string) []languageView {
	out := make([]languageView, 0, len(codes))
	for _, code := range codes {
		out = append(out, languageView{Code: code, Label: corpus.I18nLabel(code, nil)})
	}
	return out
}

// rewriteBodyWithCrossLinks —— rewrites [[X]] in body_md → [Title](/writings/slug).
// Failure (a DB error) → leaves the original text intact rather than break the
// render.
func rewriteBodyWithCrossLinks(
	ctx context.Context, h *WritingHandlers, ownerID, body string,
) string {
	if !corpus.HasCrossLinks(body) {
		return body
	}
	index, err := corpus.LoadCrossLinkIndex(ctx, h.CrossLink, ownerID)
	if err != nil {
		h.Log.Error("crosslink slug index", logErr, err)
		return body
	}
	return corpus.RewriteCrossLinksForRender(body, index)
}

// loadBacklinks —— pulls every backlink pointing at the current writing (from
// published source writings). Failure logs + returns empty (never blocks the main
// render).
func loadBacklinks(
	ctx context.Context, h *WritingHandlers, ownerID, writingID string,
) []backlinkView {
	refs, err := corpus.ListBacklinks(ctx, h.CrossLink, ownerID, writingID)
	if err != nil {
		h.Log.Error("backlinks", logErr, err)
		return []backlinkView{}
	}
	out := make([]backlinkView, 0, len(refs))
	for i := range refs {
		out = append(out, backlinkView{Slug: refs[i].Slug, Title: refs[i].Title})
	}
	return out
}

// toWritingViewResolved —— while building the response, batch-resolves every
// `standmeet-asset:<id>` reference in body_md → a presigned URL map. The frontend
// renderer uses this map to swap URIs for https URLs, and the browser hits MinIO
// directly (bypassing a backend redirect).
func toWritingViewResolved(
	r *http.Request, h *WritingHandlers, wg *corpus.Writing,
) writingView {
	v := toWritingView(wg)
	v.AssetURLs = resolveWritingAssetURLs(r, h, wg)
	return v
}

func resolveWritingAssetURLs(
	r *http.Request, h *WritingHandlers, wg *corpus.Writing,
) map[string]string {
	coverID := wg.CoverImageAssetID()
	var coverPtr *string
	if coverID != "" {
		coverPtr = &coverID
	}
	ids := corpus.WritingAssetIDs(wg.Body(), coverPtr)
	urls, err := corpus.ResolveAssetURLs(r.Context(), h.Assets.Repo, h.Assets.Storage, ids)
	if err != nil {
		h.Log.Error("resolve asset urls", logErr, err)
		return map[string]string{}
	}
	return urls
}

func toWritingView(wg *corpus.Writing) writingView {
	var pubAtPtr *time.Time
	if pub, ok := wg.PublishedAt(); ok {
		cp := pub
		pubAtPtr = &cp
	}
	return writingView{
		ID: wg.ID(), Slug: wg.Slug(), Title: wg.Title(), Excerpt: wg.Excerpt(),
		BodyMD: wg.Body(), CoverHeadline: wg.CoverHeadline(),
		CoverHue: wg.CoverHue(), CoverImageAssetID: wg.CoverImageAssetID(),
		Tags: wg.Tags(), Visibility: wg.VisibilityMode(), CrossRefs: wg.CrossRefs(),
		Path: wg.Path(), ReadMinutes: wg.ReadMinutes(), LockedBody: wg.LockedBody(),
		PublishedAt: corpus.PublishedAtRFC3339(pubAtPtr),
	}
}

func (h *WritingHandlers) handleWritingErr(w http.ResponseWriter, op string, err error) {
	if errors.Is(err, corpus.ErrWritingNotFound) {
		writeError(h.Log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "writing_not_found", Message: "writing not found",
		})
		return
	}
	h.Log.Error(op, logErr, err)
	writeError(h.Log, w, apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error",
		Message: "internal error",
	})
}
