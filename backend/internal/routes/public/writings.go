// writings.go —— public GET /api/v1/writings (list 已 published 文章) +
// GET /api/v1/writings/{slug} (article 详情，private 文章按 visibility +
// 后端不在此层做 code 鉴权：前端拿到后按 visibility=private 渲染 LockedView，
// 实际解锁需要 ?c=CODE 走 visitor session)。
//
// owner 通过 handle 隐式确定 (v1 single-owner instance；从 page deps
// LoadSoleOwner 拿)。

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

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// WritingHandlers —— public writings endpoints。
type WritingHandlers struct {
	Writings  usecases.WritingsDeps
	CrossLink usecases.CrossLinkQueryDeps
	Page      usecases.PageDeps
	Assets    usecases.AssetsDeps
	Log       *slog.Logger
}

// backlinkView —— /writings/<slug> "linked from" 用。
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
	CoverSub          string            `json:"cover_sub"`
	CoverHue          string            `json:"cover_hue"`
	Visibility        string            `json:"visibility"`
	Path              string            `json:"path"`
	LockedBody        string            `json:"locked_body,omitempty"`
	AssetURLs         map[string]string `json:"asset_urls"`
	Tags              []string          `json:"tags"`
	CrossRefs         []string          `json:"cross_refs"`
	Backlinks         []backlinkView    `json:"backlinks,omitempty"`
	ReadMinutes       int32             `json:"read_minutes"`
}

type writingsPageResp struct {
	NextCursor string        `json:"next_cursor,omitempty"`
	Writings   []writingView `json:"writings"`
}

// Mount 挂 /writings。
func (h *WritingHandlers) Mount(r chi.Router) {
	r.Get("/writings", h.list())
	r.Get("/writings/{slug}", h.get())
}

func (h *WritingHandlers) list() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner, err := usecases.LoadSoleOwner(r.Context(), h.Page)
		if err != nil {
			h.handleWritingErr(w, "load owner", err)
			return
		}
		runListWritingsPage(r, h, w, owner.ID)
	}
}

func runListWritingsPage(
	r *http.Request, h *WritingHandlers, w http.ResponseWriter, ownerID string,
) {
	in := parseWritingsPageQuery(r, ownerID)
	page, err := usecases.ListPublishedWritingsPage(r.Context(), h.Writings, in)
	if err != nil {
		h.handleWritingErr(w, "list writings page", err)
		return
	}
	writeWritingsPage(r, h, w, &page)
}

func parseWritingsPageQuery(
	r *http.Request, ownerID string,
) *usecases.ListPublishedWritingsPageInput {
	q := r.URL.Query()
	in := &usecases.ListPublishedWritingsPageInput{
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
	page *usecases.ListPublishedWritingsPageResult,
) {
	resp := buildWritingsPageResp(r, h, page)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.Log.Error("encode writings page", logErr, err)
	}
}

func buildWritingsPageResp(
	r *http.Request, h *WritingHandlers, page *usecases.ListPublishedWritingsPageResult,
) writingsPageResp {
	index := loadCrossLinkIndex(r.Context(), h, page)
	items := make([]writingView, 0, len(page.Writings))
	for i := range page.Writings {
		v := toWritingViewResolved(r, h, &page.Writings[i])
		v.BodyMD = usecases.RewriteCrossLinksForRender(v.BodyMD, index)
		items = append(items, v)
	}
	resp := writingsPageResp{Writings: items}
	if page.NextCursor != nil {
		resp.NextCursor = page.NextCursor.Format(time.RFC3339Nano)
	}
	return resp
}

// loadCrossLinkIndex —— 一次拉 owner published writing 的 slug+title 表，给
// 这页所有 writing 的 body_md rewrite 复用，避开 N+1。空 page / index 失败 → nil。
func loadCrossLinkIndex(
	ctx context.Context, h *WritingHandlers, page *usecases.ListPublishedWritingsPageResult,
) []usecases.SlugTitle {
	if len(page.Writings) == 0 {
		return nil
	}
	index, err := usecases.LoadCrossLinkIndex(ctx, h.CrossLink, page.Writings[0].OwnerID)
	if err != nil {
		h.Log.Error("crosslink slug index (list)", logErr, err)
		return nil
	}
	return index
}

func (h *WritingHandlers) get() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		owner, err := usecases.LoadSoleOwner(r.Context(), h.Page)
		if err != nil {
			h.handleWritingErr(w, "load owner", err)
			return
		}
		writing, perr := usecases.GetWritingBySlug(r.Context(), h.Writings, owner.ID, slug)
		if perr != nil {
			h.handleWritingErr(w, "get writing", perr)
			return
		}
		writeWritingResp(r, h, w, owner.ID, &writing)
	}
}

func writeWritingResp(
	r *http.Request, h *WritingHandlers, w http.ResponseWriter,
	ownerID string, wg *domain.Writing,
) {
	view := toWritingViewResolved(r, h, wg)
	view.BodyMD = rewriteBodyWithCrossLinks(r.Context(), h, ownerID, view.BodyMD)
	view.Backlinks = loadBacklinks(r.Context(), h, ownerID, wg.ID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		h.Log.Error("encode writing", logErr, err)
	}
}

// rewriteBodyWithCrossLinks —— body_md 里 [[X]] → [Title](/writings/slug)。
// 失败（DB 错）→ 留原文不破坏 render。
func rewriteBodyWithCrossLinks(
	ctx context.Context, h *WritingHandlers, ownerID, body string,
) string {
	if !usecases.HasCrossLinks(body) {
		return body
	}
	index, err := usecases.LoadCrossLinkIndex(ctx, h.CrossLink, ownerID)
	if err != nil {
		h.Log.Error("crosslink slug index", logErr, err)
		return body
	}
	return usecases.RewriteCrossLinksForRender(body, index)
}

// loadBacklinks —— 拉指向当前 writing 的所有 (源 published writing 的) backlink。
// 失败 log + 返空（不阻塞主 render）。
func loadBacklinks(
	ctx context.Context, h *WritingHandlers, ownerID, writingID string,
) []backlinkView {
	refs, err := usecases.ListBacklinks(ctx, h.CrossLink, ownerID, writingID)
	if err != nil {
		h.Log.Error("backlinks", logErr, err)
		return nil
	}
	out := make([]backlinkView, 0, len(refs))
	for i := range refs {
		out = append(out, backlinkView{Slug: refs[i].Slug, Title: refs[i].Title})
	}
	return out
}

// toWritingViewResolved —— build response 时 batch resolve body_md 里所有
// `standmeet-asset:<id>` 引用 → presigned URL map。前端 renderer 用这个
// map 把 URI 换成 https URL，浏览器直 hit MinIO（绕 backend redirect）。
func toWritingViewResolved(r *http.Request, h *WritingHandlers, wg *domain.Writing) writingView {
	v := toWritingView(wg)
	v.AssetURLs = resolveWritingAssetURLs(r, h, wg)
	return v
}

func resolveWritingAssetURLs(
	r *http.Request, h *WritingHandlers, wg *domain.Writing,
) map[string]string {
	ids := usecases.WritingAssetIDs(wg.BodyMD, wg.CoverImageAssetID)
	urls, err := usecases.ResolveAssetURLs(r.Context(), h.Assets.Repo, h.Assets.Storage, ids)
	if err != nil {
		h.Log.Error("resolve asset urls", logErr, err)
		return map[string]string{}
	}
	return urls
}

func toWritingView(wg *domain.Writing) writingView {
	assetID := ""
	if wg.CoverImageAssetID != nil {
		assetID = *wg.CoverImageAssetID
	}
	return writingView{
		ID: wg.ID, Slug: wg.Slug, Title: wg.Title, Excerpt: wg.Excerpt,
		BodyMD: wg.BodyMD, CoverHeadline: wg.CoverHeadline, CoverSub: wg.CoverSub,
		CoverHue: wg.CoverHue, CoverImageAssetID: assetID,
		Tags: wg.Tags, Visibility: wg.Visibility, CrossRefs: wg.CrossRefs,
		Path: wg.Path, ReadMinutes: wg.ReadMinutes, LockedBody: wg.LockedBody,
		PublishedAt: usecases.PublishedAtRFC3339(wg.PublishedAt),
	}
}

func (h *WritingHandlers) handleWritingErr(w http.ResponseWriter, op string, err error) {
	if errors.Is(err, domain.ErrWritingNotFound) {
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
