// posts.go —— public GET /api/v1/posts (list 已 published 文章) +
// GET /api/v1/posts/{slug} (article 详情，private 文章按 visibility +
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

// PostHandlers —— public posts endpoints。
type PostHandlers struct {
	Posts     usecases.PostsDeps
	CrossLink usecases.CrossLinkQueryDeps
	Page      usecases.PageDeps
	Assets    usecases.AssetsDeps
	Log       *slog.Logger
}

// backlinkView —— /blog/<slug> "linked from" 用。
type backlinkView struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

type postView struct {
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

type postsPageResp struct {
	NextCursor string     `json:"next_cursor,omitempty"`
	Posts      []postView `json:"posts"`
}

// Mount 挂 /posts。
func (h *PostHandlers) Mount(r chi.Router) {
	r.Get("/posts", h.list())
	r.Get("/posts/{slug}", h.get())
}

func (h *PostHandlers) list() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner, err := usecases.LoadSoleOwner(r.Context(), h.Page)
		if err != nil {
			h.handlePostErr(w, "load owner", err)
			return
		}
		runListPostsPage(r, h, w, owner.ID)
	}
}

func runListPostsPage(r *http.Request, h *PostHandlers, w http.ResponseWriter, ownerID string) {
	in := parsePostsPageQuery(r, ownerID)
	page, err := usecases.ListPublishedPostsPage(r.Context(), h.Posts, in)
	if err != nil {
		h.handlePostErr(w, "list posts page", err)
		return
	}
	writePostsPage(r, h, w, &page)
}

func parsePostsPageQuery(
	r *http.Request, ownerID string,
) *usecases.ListPublishedPostsPageInput {
	q := r.URL.Query()
	in := &usecases.ListPublishedPostsPageInput{
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

func writePostsPage(
	r *http.Request, h *PostHandlers, w http.ResponseWriter,
	page *usecases.ListPublishedPostsPageResult,
) {
	resp := buildPostsPageResp(r, h, page)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.Log.Error("encode posts page", logErr, err)
	}
}

func buildPostsPageResp(
	r *http.Request, h *PostHandlers, page *usecases.ListPublishedPostsPageResult,
) postsPageResp {
	index := loadCrossLinkIndex(r.Context(), h, page)
	items := make([]postView, 0, len(page.Posts))
	for i := range page.Posts {
		v := toPostViewResolved(r, h, &page.Posts[i])
		v.BodyMD = usecases.RewriteCrossLinksForRender(v.BodyMD, index)
		items = append(items, v)
	}
	resp := postsPageResp{Posts: items}
	if page.NextCursor != nil {
		resp.NextCursor = page.NextCursor.Format(time.RFC3339Nano)
	}
	return resp
}

// loadCrossLinkIndex —— 一次拉 owner published post 的 slug+title 表，给
// 这页所有 post 的 body_md rewrite 复用，避开 N+1。空 page / index 失败 → nil。
func loadCrossLinkIndex(
	ctx context.Context, h *PostHandlers, page *usecases.ListPublishedPostsPageResult,
) []usecases.SlugTitle {
	if len(page.Posts) == 0 {
		return nil
	}
	index, err := usecases.LoadCrossLinkIndex(ctx, h.CrossLink, page.Posts[0].OwnerID)
	if err != nil {
		h.Log.Error("crosslink slug index (list)", logErr, err)
		return nil
	}
	return index
}

func (h *PostHandlers) get() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		owner, err := usecases.LoadSoleOwner(r.Context(), h.Page)
		if err != nil {
			h.handlePostErr(w, "load owner", err)
			return
		}
		post, perr := usecases.GetPostBySlug(r.Context(), h.Posts, owner.ID, slug)
		if perr != nil {
			h.handlePostErr(w, "get post", perr)
			return
		}
		writePostResp(r, h, w, owner.ID, &post)
	}
}

func writePostResp(
	r *http.Request, h *PostHandlers, w http.ResponseWriter,
	ownerID string, p *domain.Post,
) {
	view := toPostViewResolved(r, h, p)
	view.BodyMD = rewriteBodyWithCrossLinks(r.Context(), h, ownerID, view.BodyMD)
	view.Backlinks = loadBacklinks(r.Context(), h, ownerID, p.ID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		h.Log.Error("encode post", logErr, err)
	}
}

// rewriteBodyWithCrossLinks —— body_md 里 [[X]] → [Title](/blog/slug)。失败
// （DB 错）→ 留原文不破坏 render。
func rewriteBodyWithCrossLinks(
	ctx context.Context, h *PostHandlers, ownerID, body string,
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

// loadBacklinks —— 拉指向当前 post 的所有 (源 published post 的) backlink。
// 失败 log + 返空（不阻塞主 render）。
func loadBacklinks(
	ctx context.Context, h *PostHandlers, ownerID, postID string,
) []backlinkView {
	refs, err := usecases.ListBacklinks(ctx, h.CrossLink, ownerID, postID)
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

// toPostViewResolved —— build response 时 batch resolve body_md 里所有
// `standmeet-asset:<id>` 引用 → presigned URL map。前端 renderer 用这个
// map 把 URI 换成 https URL，浏览器直 hit MinIO（绕 backend redirect）。
func toPostViewResolved(r *http.Request, h *PostHandlers, p *domain.Post) postView {
	v := toPostView(p)
	v.AssetURLs = resolvePostAssetURLs(r, h, p)
	return v
}

func resolvePostAssetURLs(r *http.Request, h *PostHandlers, p *domain.Post) map[string]string {
	ids := usecases.PostAssetIDs(p.BodyMD, p.CoverImageAssetID)
	urls, err := usecases.ResolveAssetURLs(r.Context(), h.Assets.Repo, h.Assets.Storage, ids)
	if err != nil {
		h.Log.Error("resolve asset urls", logErr, err)
		return map[string]string{}
	}
	return urls
}

func toPostView(p *domain.Post) postView {
	assetID := ""
	if p.CoverImageAssetID != nil {
		assetID = *p.CoverImageAssetID
	}
	return postView{
		ID: p.ID, Slug: p.Slug, Title: p.Title, Excerpt: p.Excerpt,
		BodyMD: p.BodyMD, CoverHeadline: p.CoverHeadline, CoverSub: p.CoverSub,
		CoverHue: p.CoverHue, CoverImageAssetID: assetID,
		Tags: p.Tags, Visibility: p.Visibility, CrossRefs: p.CrossRefs,
		Path: p.Path, ReadMinutes: p.ReadMinutes, LockedBody: p.LockedBody,
		PublishedAt: usecases.PublishedAtRFC3339(p.PublishedAt),
	}
}

func (h *PostHandlers) handlePostErr(w http.ResponseWriter, op string, err error) {
	if errors.Is(err, domain.ErrPostNotFound) {
		writeError(h.Log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "post_not_found", Message: "post not found",
		})
		return
	}
	h.Log.Error(op, logErr, err)
	writeError(h.Log, w, apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error",
		Message: "internal error",
	})
}
