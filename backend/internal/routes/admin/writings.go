// writings.go —— admin /writings endpoint: list / create / update / publish /
// delete。create + update 接 multipart：form field "data" 是 JSON writing
// fields，form fields 'file:<pending-id>' 是内联 image bytes。usecase
// SaveWriting 同事务做 upload + insert/update writing + insert assets 行。
// orphan / scan / standalone /assets endpoint 不存在。

package admin

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const timeFmt = time.RFC3339

// WritingsAdminDeps —— admin writings handlers 依赖。Writings (slim) 用于
// 读 / publish；WritingsTx (with Assets) 用于 create / update / delete。
type WritingsAdminDeps struct {
	Writings   usecases.WritingsDeps
	WritingsTx usecases.WritingsTxDeps
}

type writingView struct {
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
	ParentID          string            `json:"parent_id"`
	AssetURLs         map[string]string `json:"asset_urls"`
	Tags              []string          `json:"tags"`
	CrossRefs         []string          `json:"cross_refs"`
	ReadMinutes       int32             `json:"read_minutes"`
	Published         bool              `json:"published"`
}

// writingSaveRequest —— create + update 共用 JSON shape。WritingID 来自 URL，
// 不在 body。CoverImageRef 是 pending-<id> 或已有 asset 真 UUID 或空。
type writingSaveRequest struct {
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
	ParentID      string   `json:"parent_id"`
	Tags          []string `json:"tags"`
	CrossRefs     []string `json:"cross_refs"`
	Publish       bool     `json:"publish"`
}

// MountWritings 挂 /writings 子路由。
func (h *Handlers) MountWritings(r chi.Router) {
	r.Route("/writings", func(r chi.Router) {
		r.Get("/", h.listAdminWritings())
		r.Post("/", h.createAdminWriting())
		r.Patch("/{id}", h.updateAdminWriting())
		r.Post("/{id}/publish", h.publishAdminWriting())
		r.Post("/{id}/unpublish", h.unpublishAdminWriting())
		r.Delete("/{id}", h.deleteAdminWriting())
	})
}

func (h *Handlers) listAdminWritings() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := usecases.ListAllWritings(r.Context(), h.WritingsAdmin.Writings, ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list writings", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeWritingsList(r, h, w, rows)
	}
}

func writeWritingsList(
	r *http.Request, h *Handlers, w http.ResponseWriter, rows []domain.Writing,
) {
	items := make([]writingView, 0, len(rows))
	for i := range rows {
		items = append(items, toWritingViewResolved(r, h, &rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(h.Log, "encode writings", err)
	}
}

func toWritingViewResolved(r *http.Request, h *Handlers, wg *domain.Writing) writingView {
	v := toWritingView(wg)
	v.AssetURLs = resolveWritingAssetURLs(r, h, wg)
	return v
}

func resolveWritingAssetURLs(r *http.Request, h *Handlers, wg *domain.Writing) map[string]string {
	coverID := wg.CoverImageAssetID()
	var coverPtr *string
	if coverID != "" {
		coverPtr = &coverID
	}
	ids := usecases.WritingAssetIDs(wg.Body(), coverPtr)
	urls, err := usecases.ResolveAssetURLs(
		r.Context(),
		h.WritingsAdmin.WritingsTx.Assets.Repo,
		h.WritingsAdmin.WritingsTx.Assets.Storage,
		ids,
	)
	if err != nil {
		h.Log.Error("resolve asset urls", "err", err)
		return map[string]string{}
	}
	return urls
}

// writingParentIDOr —— parent id 或 ""(root)。editor 回填「设父」用。
func writingParentIDOr(wg *domain.Writing) string {
	pid, _ := wg.ParentID()
	return pid
}

func toWritingView(wg *domain.Writing) writingView {
	var pubAtPtr *time.Time
	if pub, ok := wg.PublishedAt(); ok {
		cp := pub
		pubAtPtr = &cp
	}
	return writingView{
		ID: wg.ID(), Slug: wg.Slug(), Title: wg.Title(), Excerpt: wg.Excerpt(),
		BodyMD: wg.Body(), CoverHeadline: wg.CoverHeadline(), CoverSub: wg.CoverSub(),
		CoverHue: wg.CoverHue(), CoverImageAssetID: wg.CoverImageAssetID(),
		Tags: wg.Tags(), Visibility: wg.VisibilityMode(), CrossRefs: wg.CrossRefs(),
		Path: wg.Path(), ReadMinutes: wg.ReadMinutes(), LockedBody: wg.LockedBody(),
		ParentID:    writingParentIDOr(wg),
		Published:   wg.IsPublished(),
		PublishedAt: usecases.PublishedAtRFC3339(pubAtPtr),
		CreatedAt:   wg.CreatedAt().Format(timeFmt),
		UpdatedAt:   wg.UpdatedAt().Format(timeFmt),
	}
}

func (h *Handlers) createAdminWriting() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runMultipartSave(r, h, w, "")
	}
}

func (h *Handlers) updateAdminWriting() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runMultipartSave(r, h, w, chi.URLParam(r, "id"))
	}
}

func runMultipartSave(
	r *http.Request, h *Handlers, w http.ResponseWriter, writingID string,
) {
	parsed, perr := parseWritingMultipart(w, r)
	if perr != nil {
		writeError(h.Log, w, envBadReq(perr.Error()))
		return
	}
	runSaveAdminWriting(r.Context(),
		&saveAdminWritingCtx{R: r, H: h, W: w, Parsed: &parsed, WritingID: writingID})
}

// saveAdminWritingCtx —— runSaveAdminWriting 参数包，避开 argument-limit 5。
// fieldalignment: pointer 先，interface 后，string 最后。
type saveAdminWritingCtx struct {
	R         *http.Request
	H         *Handlers
	Parsed    *parsedMultipart
	W         http.ResponseWriter
	WritingID string
}

func runSaveAdminWriting(ctx context.Context, sc *saveAdminWritingCtx) {
	ownerID := middleware.OwnerIDFrom(ctx)
	in := buildSaveWritingInput(ownerID, sc.WritingID, &sc.Parsed.Req, sc.Parsed.Files)
	wg, err := usecases.SaveWriting(ctx, sc.H.WritingsAdmin.WritingsTx, in)
	if err != nil {
		handleSaveWritingErr(sc.H.Log, sc.W, err)
		return
	}
	statusCode := http.StatusOK
	if sc.WritingID == "" {
		statusCode = http.StatusCreated
	}
	writeSavedWriting(sc.R, sc.H, sc.W, &wg, statusCode)
}

func buildSaveWritingInput(
	ownerID, writingID string, req *writingSaveRequest, files []usecases.FileInput,
) *usecases.SaveWritingInput {
	return &usecases.SaveWritingInput{
		OwnerID: ownerID, WritingID: writingID, Slug: req.Slug, Title: req.Title,
		Excerpt: req.Excerpt, BodyMD: req.BodyMD,
		CoverImageRef: req.CoverImageRef, CoverHeadline: req.CoverHeadline,
		CoverSub: req.CoverSub, CoverHue: req.CoverHue,
		Visibility: req.Visibility, LockedBody: req.LockedBody,
		Tags: req.Tags, CrossRefs: req.CrossRefs, Files: files,
		ParentID: req.ParentID, Publish: req.Publish,
	}
}

var saveWritingErrCases = []apierr.Case{
	{Match: usecases.ErrEmptyField, Envelope: envBadReq("owner_id, slug, title required")},
	{Match: domain.ErrWritingSlugTaken, Envelope: apierr.Envelope{
		Status: http.StatusConflict, Code: "writing_slug_taken",
		Message: "writing slug already taken",
	}},
	{Match: domain.ErrParentNotFound, Envelope: envBadReq("parent writing not found")},
	{Match: domain.ErrParentCycle, Envelope: envBadReq("parent would create a cycle")},
}

func handleSaveWritingErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, saveWritingErrCases)
	if env.Status >= http.StatusInternalServerError {
		log.Error("save writing", "err", err)
	}
	writeError(log, w, env)
}

func writeSavedWriting(
	r *http.Request, h *Handlers, w http.ResponseWriter, wg *domain.Writing, statusCode int,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(toWritingViewResolved(r, h, wg)); err != nil {
		logEncodeErr(h.Log, "encode writing", err)
	}
}

func writeWritingResp(r *http.Request, h *Handlers, w http.ResponseWriter, wg *domain.Writing) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(toWritingViewResolved(r, h, wg)); err != nil {
		logEncodeErr(h.Log, "encode writing", err)
	}
}

func (h *Handlers) publishAdminWriting() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		writingID := chi.URLParam(r, "id")
		wg, err := usecases.PublishWriting(
			r.Context(), h.WritingsAdmin.Writings, ownerID, writingID,
		)
		if err != nil {
			logEncodeErr(h.Log, "publish writing", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeWritingResp(r, h, w, &wg)
	}
}

func (h *Handlers) unpublishAdminWriting() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		writingID := chi.URLParam(r, "id")
		wg, err := usecases.UnpublishWriting(
			r.Context(), h.WritingsAdmin.Writings, ownerID, writingID,
		)
		if err != nil {
			logEncodeErr(h.Log, "unpublish writing", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeWritingResp(r, h, w, &wg)
	}
}

func (h *Handlers) deleteAdminWriting() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		writingID := chi.URLParam(r, "id")
		err := usecases.DeleteWritingWithAssets(
			r.Context(), h.WritingsAdmin.WritingsTx, ownerID, writingID,
		)
		if err != nil {
			logEncodeErr(h.Log, "delete writing", err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
