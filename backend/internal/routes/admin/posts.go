// posts.go —— admin /posts endpoint: list / create / update / publish /
// delete。create + update 接 multipart：form field "data" 是 JSON post
// fields，form fields 'file:<pending-id>' 是内联 image bytes。usecase
// SavePost 同事务做 upload + insert/update post + insert assets 行。
// orphan / scan / standalone /assets endpoint 不存在。

package admin

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/usecases"
)

const timeFmt = time.RFC3339

// PostsAdminDeps —— admin posts handlers 依赖。Posts (slim) 用于读 / publish；
// PostsTx (with Assets) 用于 create / update / delete。
type PostsAdminDeps struct {
	Posts   usecases.PostsDeps
	PostsTx usecases.PostsTxDeps
}

type postView struct {
	PublishedAt       string            `json:"published_at,omitempty"`
	UpdatedAt         string            `json:"updated_at"`
	CreatedAt         string            `json:"created_at"`
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
	LockedBody        string            `json:"locked_body"`
	AssetURLs         map[string]string `json:"asset_urls"`
	Tags              []string          `json:"tags"`
	CrossRefs         []string          `json:"cross_refs"`
	ReadMinutes       int32             `json:"read_minutes"`
	Published         bool              `json:"published"`
}

// postSaveRequest —— create + update 共用 JSON shape。PostID 来自 URL，
// 不在 body。CoverImageRef 是 pending-<id> 或已有 asset 真 UUID 或空。
type postSaveRequest struct {
	Slug          string   `json:"slug"`
	Title         string   `json:"title"`
	Excerpt       string   `json:"excerpt"`
	BodyMD        string   `json:"body_md"`
	CoverImageRef string   `json:"cover_image_ref"`
	CoverHeadline string   `json:"cover_headline"`
	CoverSub      string   `json:"cover_sub"`
	CoverHue      string   `json:"cover_hue"`
	Visibility    string   `json:"visibility"`
	LockedBody    string   `json:"locked_body"`
	Tags          []string `json:"tags"`
	CrossRefs     []string `json:"cross_refs"`
	Publish       bool     `json:"publish"`
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
		writePostsList(r, h, w, rows)
	}
}

func writePostsList(
	r *http.Request, h *Handlers, w http.ResponseWriter, rows []domain.Post,
) {
	items := make([]postView, 0, len(rows))
	for i := range rows {
		items = append(items, toPostViewResolved(r, h, &rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(h.Log, "encode posts", err)
	}
}

func toPostViewResolved(r *http.Request, h *Handlers, p *domain.Post) postView {
	v := toPostView(p)
	v.AssetURLs = resolvePostAssetURLs(r, h, p)
	return v
}

func resolvePostAssetURLs(r *http.Request, h *Handlers, p *domain.Post) map[string]string {
	ids := usecases.PostAssetIDs(p.BodyMD, p.CoverImageAssetID)
	urls, err := usecases.ResolveAssetURLs(
		r.Context(),
		h.PostsAdmin.PostsTx.Assets.Repo,
		h.PostsAdmin.PostsTx.Assets.Storage,
		ids,
	)
	if err != nil {
		h.Log.Error("resolve asset urls", "err", err)
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
		Published:   p.IsPublished(),
		PublishedAt: usecases.PublishedAtRFC3339(p.PublishedAt),
		CreatedAt:   p.CreatedAt.Format(timeFmt),
		UpdatedAt:   p.UpdatedAt.Format(timeFmt),
	}
}

func (h *Handlers) createAdminPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runMultipartSave(r, h, w, "")
	}
}

func (h *Handlers) updateAdminPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runMultipartSave(r, h, w, chi.URLParam(r, "id"))
	}
}

func runMultipartSave(
	r *http.Request, h *Handlers, w http.ResponseWriter, postID string,
) {
	parsed, perr := parsePostMultipart(w, r)
	if perr != nil {
		writeError(h.Log, w, envBadReq(perr.Error()))
		return
	}
	runSaveAdminPost(r.Context(),
		&saveAdminPostCtx{R: r, H: h, W: w, Parsed: &parsed, PostID: postID})
}

// saveAdminPostCtx —— runSaveAdminPost 参数包，避开 argument-limit 5。
// fieldalignment: pointer 先，interface 后，string 最后。
type saveAdminPostCtx struct {
	R      *http.Request
	H      *Handlers
	Parsed *parsedMultipart
	W      http.ResponseWriter
	PostID string
}

func runSaveAdminPost(ctx context.Context, sc *saveAdminPostCtx) {
	ownerID := middleware.OwnerIDFrom(ctx)
	in := buildSavePostInput(ownerID, sc.PostID, &sc.Parsed.Req, sc.Parsed.Files)
	post, err := usecases.SavePost(ctx, sc.H.PostsAdmin.PostsTx, in)
	if err != nil {
		handleSavePostErr(sc.H.Log, sc.W, err)
		return
	}
	statusCode := http.StatusOK
	if sc.PostID == "" {
		statusCode = http.StatusCreated
	}
	writeSavedPost(sc.R, sc.H, sc.W, &post, statusCode)
}

func buildSavePostInput(
	ownerID, postID string, req *postSaveRequest, files []usecases.FileInput,
) *usecases.SavePostInput {
	return &usecases.SavePostInput{
		OwnerID: ownerID, PostID: postID, Slug: req.Slug, Title: req.Title,
		Excerpt: req.Excerpt, BodyMD: req.BodyMD,
		CoverImageRef: req.CoverImageRef, CoverHeadline: req.CoverHeadline,
		CoverSub: req.CoverSub, CoverHue: req.CoverHue,
		Visibility: req.Visibility, LockedBody: req.LockedBody,
		Tags: req.Tags, CrossRefs: req.CrossRefs, Files: files,
		Publish: req.Publish,
	}
}

func handleSavePostErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, usecases.ErrEmptyField):
		writeError(log, w, envBadReq("owner_id, slug, title required"))
	case errors.Is(err, domain.ErrPostSlugTaken):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusConflict, Code: "post_slug_taken",
			Message: "post slug already taken",
		})
	default:
		logEncodeErr(log, "save post", err)
		writeError(log, w, serverErr())
	}
}

func writeSavedPost(
	r *http.Request, h *Handlers, w http.ResponseWriter, p *domain.Post, statusCode int,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(toPostViewResolved(r, h, p)); err != nil {
		logEncodeErr(h.Log, "encode post", err)
	}
}

func writePostResp(r *http.Request, h *Handlers, w http.ResponseWriter, p *domain.Post) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(toPostViewResolved(r, h, p)); err != nil {
		logEncodeErr(h.Log, "encode post", err)
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
		writePostResp(r, h, w, &post)
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
		writePostResp(r, h, w, &post)
	}
}

func (h *Handlers) deleteAdminPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		postID := chi.URLParam(r, "id")
		err := usecases.DeletePostWithAssets(r.Context(), h.PostsAdmin.PostsTx, ownerID, postID)
		if err != nil {
			logEncodeErr(h.Log, "delete post", err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
