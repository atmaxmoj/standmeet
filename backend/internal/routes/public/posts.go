// posts.go —— public GET /api/v1/posts (list 已 published 文章) +
// GET /api/v1/posts/{slug} (article 详情，private 文章按 visibility +
// 后端不在此层做 code 鉴权：前端拿到后按 visibility=private 渲染 LockedView，
// 实际解锁需要 ?c=CODE 走 visitor session)。
//
// owner 通过 handle 隐式确定 (v1 single-owner instance；从 page deps
// LoadSoleOwner 拿)。

package public

import (
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
	Posts usecases.PostsDeps
	Page  usecases.PageDeps
	Log   *slog.Logger
}

type postView struct {
	PublishedAt       string             `json:"published_at,omitempty"`
	CoverImageAssetID string             `json:"cover_image_asset_id,omitempty"`
	ID                string             `json:"id"`
	Slug              string             `json:"slug"`
	Title             string             `json:"title"`
	Excerpt           string             `json:"excerpt"`
	CoverHeadline     string             `json:"cover_headline"`
	CoverSub          string             `json:"cover_sub"`
	CoverHue          string             `json:"cover_hue"`
	Visibility        string             `json:"visibility"`
	Path              string             `json:"path"`
	LockedBody        string             `json:"locked_body,omitempty"`
	Body              []domain.PostBlock `json:"body"`
	Tags              []string           `json:"tags"`
	CrossRefs         []string           `json:"cross_refs"`
	ReadMinutes       int32              `json:"read_minutes"`
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
	writePostsPage(h.Log, w, &page)
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
	log *slog.Logger, w http.ResponseWriter, page *usecases.ListPublishedPostsPageResult,
) {
	resp := buildPostsPageResp(page)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode posts page", "err", err)
	}
}

func buildPostsPageResp(page *usecases.ListPublishedPostsPageResult) postsPageResp {
	items := make([]postView, 0, len(page.Posts))
	for i := range page.Posts {
		items = append(items, toPostView(&page.Posts[i]))
	}
	resp := postsPageResp{Posts: items}
	if page.NextCursor != nil {
		resp.NextCursor = page.NextCursor.Format(time.RFC3339Nano)
	}
	return resp
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
		writePostResp(h.Log, w, &post)
	}
}

func writePostResp(log *slog.Logger, w http.ResponseWriter, p *domain.Post) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(toPostView(p)); err != nil {
		log.Error("encode post", "err", err)
	}
}

func toPostView(p *domain.Post) postView {
	assetID := ""
	if p.CoverImageAssetID != nil {
		assetID = *p.CoverImageAssetID
	}
	return postView{
		ID: p.ID, Slug: p.Slug, Title: p.Title, Excerpt: p.Excerpt,
		Body: p.Body, CoverHeadline: p.CoverHeadline, CoverSub: p.CoverSub,
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
	h.Log.Error(op, "err", err)
	writeError(h.Log, w, apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error",
		Message: "internal error",
	})
}
