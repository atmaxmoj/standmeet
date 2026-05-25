// posts.go —— admin /posts endpoint: list / create / update / publish /
// delete。body 是 markdown 原文，直接透传到 repo。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// PostsAdminDeps —— admin posts handlers 依赖。
type PostsAdminDeps struct {
	Posts usecases.PostsDeps
}

type postView struct {
	PublishedAt       string   `json:"published_at,omitempty"`
	UpdatedAt         string   `json:"updated_at"`
	CreatedAt         string   `json:"created_at"`
	CoverImageAssetID string   `json:"cover_image_asset_id,omitempty"`
	ID                string   `json:"id"`
	Slug              string   `json:"slug"`
	Title             string   `json:"title"`
	Excerpt           string   `json:"excerpt"`
	BodyMD            string   `json:"body_md"`
	CoverHeadline     string   `json:"cover_headline"`
	CoverSub          string   `json:"cover_sub"`
	CoverHue          string   `json:"cover_hue"`
	Visibility        string   `json:"visibility"`
	Path              string   `json:"path"`
	LockedBody        string   `json:"locked_body"`
	Tags              []string `json:"tags"`
	CrossRefs         []string `json:"cross_refs"`
	ReadMinutes       int32    `json:"read_minutes"`
	Published         bool     `json:"published"`
}

type createPostRequest struct {
	CoverImageAssetID string   `json:"cover_image_asset_id"`
	Slug              string   `json:"slug"`
	Title             string   `json:"title"`
	Excerpt           string   `json:"excerpt"`
	BodyMD            string   `json:"body_md"`
	CoverHeadline     string   `json:"cover_headline"`
	CoverSub          string   `json:"cover_sub"`
	CoverHue          string   `json:"cover_hue"`
	Visibility        string   `json:"visibility"`
	LockedBody        string   `json:"locked_body"`
	Tags              []string `json:"tags"`
	CrossRefs         []string `json:"cross_refs"`
	Publish           bool     `json:"publish"`
}

type updatePostRequest struct {
	CoverImageAssetID string   `json:"cover_image_asset_id"`
	Title             string   `json:"title"`
	Excerpt           string   `json:"excerpt"`
	BodyMD            string   `json:"body_md"`
	CoverHeadline     string   `json:"cover_headline"`
	CoverSub          string   `json:"cover_sub"`
	CoverHue          string   `json:"cover_hue"`
	Visibility        string   `json:"visibility"`
	LockedBody        string   `json:"locked_body"`
	Tags              []string `json:"tags"`
	CrossRefs         []string `json:"cross_refs"`
}

// MountPosts 挂 /posts 子路由。
func (h *Handlers) MountPosts(r chi.Router) {
	r.Route("/posts", func(r chi.Router) {
		r.Get("/", h.listAdminPosts())
		r.Post("/", h.createAdminPost())
		r.Patch("/{id}", h.updateAdminPost())
		r.Post("/{id}/publish", h.publishAdminPost())
		r.Post("/{id}/unpublish", h.unpublishAdminPost())
		r.Delete("/{id}", h.deleteAdminPost())
	})
}

func (h *Handlers) listAdminPosts() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := usecases.ListAllPosts(r.Context(), h.PostsAdmin.Posts, ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list posts", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writePostsList(h.Log, w, rows)
	}
}

func writePostsList(log *slog.Logger, w http.ResponseWriter, rows []domain.Post) {
	items := make([]postView, 0, len(rows))
	for i := range rows {
		items = append(items, toPostView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(log, "encode posts", err)
	}
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
		Published:   p.IsPublished(),
		PublishedAt: usecases.PublishedAtRFC3339(p.PublishedAt),
		CreatedAt:   p.CreatedAt.Format(timeFmt),
		UpdatedAt:   p.UpdatedAt.Format(timeFmt),
	}
}

func (h *Handlers) createAdminPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createPostRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runCreateAdminPost(r, h, w, &req)
	}
}

func runCreateAdminPost(
	r *http.Request, h *Handlers, w http.ResponseWriter, req *createPostRequest,
) {
	ownerID := middleware.OwnerIDFrom(r.Context())
	in := buildCreatePostUsecaseInput(ownerID, req)
	post, err := usecases.CreatePost(r.Context(), h.PostsAdmin.Posts, in)
	if err != nil {
		handleCreatePostErr(h.Log, w, err)
		return
	}
	writeCreatedPost(h.Log, w, &post)
}

func buildCreatePostUsecaseInput(
	ownerID string, req *createPostRequest,
) *usecases.CreatePostInput {
	var assetID *string
	if req.CoverImageAssetID != "" {
		v := req.CoverImageAssetID
		assetID = &v
	}
	return &usecases.CreatePostInput{
		OwnerID: ownerID, Slug: req.Slug, Title: req.Title, Excerpt: req.Excerpt,
		BodyMD:        req.BodyMD,
		CoverHeadline: req.CoverHeadline, CoverSub: req.CoverSub,
		CoverHue: req.CoverHue, CoverImageAssetID: assetID,
		Tags: req.Tags, Visibility: req.Visibility, CrossRefs: req.CrossRefs,
		LockedBody: req.LockedBody, Publish: req.Publish,
	}
}

func handleCreatePostErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, usecases.ErrEmptyField):
		writeError(log, w, envBadReq("owner_id, slug, title required"))
	case errors.Is(err, domain.ErrPostSlugTaken):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusConflict, Code: "post_slug_taken",
			Message: "post slug already taken",
		})
	default:
		logEncodeErr(log, "create post", err)
		writeError(log, w, serverErr())
	}
}

func writeCreatedPost(log *slog.Logger, w http.ResponseWriter, p *domain.Post) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(toPostView(p)); err != nil {
		logEncodeErr(log, "encode post", err)
	}
}

func (h *Handlers) updateAdminPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req updatePostRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runUpdateAdminPost(r, h, w, &req)
	}
}

func runUpdateAdminPost(
	r *http.Request, h *Handlers, w http.ResponseWriter, req *updatePostRequest,
) {
	ownerID := middleware.OwnerIDFrom(r.Context())
	postID := chi.URLParam(r, "id")
	in := buildUpdatePostUsecaseInput(ownerID, postID, req)
	post, err := usecases.UpdatePost(r.Context(), h.PostsAdmin.Posts, in)
	if err != nil {
		logEncodeErr(h.Log, "update post", err)
		writeError(h.Log, w, serverErr())
		return
	}
	writePostResp(h.Log, w, &post)
}

func buildUpdatePostUsecaseInput(
	ownerID, postID string, req *updatePostRequest,
) *usecases.UpdatePostInput {
	var assetID *string
	if req.CoverImageAssetID != "" {
		v := req.CoverImageAssetID
		assetID = &v
	}
	return &usecases.UpdatePostInput{
		OwnerID: ownerID, PostID: postID,
		Title: req.Title, Excerpt: req.Excerpt,
		BodyMD:        req.BodyMD,
		CoverHeadline: req.CoverHeadline, CoverSub: req.CoverSub,
		CoverHue: req.CoverHue, CoverImageAssetID: assetID,
		Tags: req.Tags, Visibility: req.Visibility, CrossRefs: req.CrossRefs,
		LockedBody: req.LockedBody,
	}
}

func writePostResp(log *slog.Logger, w http.ResponseWriter, p *domain.Post) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(toPostView(p)); err != nil {
		logEncodeErr(log, "encode post", err)
	}
}

func (h *Handlers) publishAdminPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		postID := chi.URLParam(r, "id")
		post, err := usecases.PublishPost(r.Context(), h.PostsAdmin.Posts, ownerID, postID)
		if err != nil {
			logEncodeErr(h.Log, "publish post", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writePostResp(h.Log, w, &post)
	}
}

func (h *Handlers) unpublishAdminPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		postID := chi.URLParam(r, "id")
		post, err := usecases.UnpublishPost(r.Context(), h.PostsAdmin.Posts, ownerID, postID)
		if err != nil {
			logEncodeErr(h.Log, "unpublish post", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writePostResp(h.Log, w, &post)
	}
}

func (h *Handlers) deleteAdminPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		postID := chi.URLParam(r, "id")
		err := usecases.DeletePost(r.Context(), h.PostsAdmin.Posts, ownerID, postID)
		if err != nil {
			logEncodeErr(h.Log, "delete post", err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
