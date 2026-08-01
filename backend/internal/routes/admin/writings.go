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

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

const timeFmt = time.RFC3339

// WritingsAdminDeps —— admin writings handlers 依赖。Face 给列出 / 发布 / 删除；
// WritingsTx 还留着,因为 save 是 multipart,还没搬进收口(见 MountWritings)。
type WritingsAdminDeps struct {
	Face       *dispatcher.Face
	WritingsTx corpus.WritingsTxDeps
	Tree       WritingsTreeProvider // lazy tree + grid pagination (concrete WritingRepo)
}

type writingView struct {
	PublishedAt       string `json:"published_at,omitempty"`
	UpdatedAt         string `json:"updated_at"`
	CreatedAt         string `json:"created_at"`
	CoverImageAssetID string `json:"cover_image_asset_id,omitempty"`
	ID                string `json:"id"`
	Slug              string `json:"slug"`
	Title             string `json:"title"`
	Excerpt           string `json:"excerpt"`
	BodyMD            string `json:"body_md"`
	// Preview —— a CLEAN lead excerpt (LeadLine: markup/structure stripped) for the card, shown
	// when Excerpt is empty. BodyMD stays the raw source for editing; the card must never render a
	// raw substring of it (F-R-1 — same class as the raw/wiki lists).
	Preview       string            `json:"preview"`
	CoverHeadline string            `json:"cover_headline"`
	CoverHue      string            `json:"cover_hue"`
	Visibility    string            `json:"visibility"`
	Path          string            `json:"path"`
	LockedBody    string            `json:"locked_body"`
	ParentID      string            `json:"parent_id"`
	AssetURLs     map[string]string `json:"asset_urls"`
	Tags          []string          `json:"tags"`
	CrossRefs     []string          `json:"cross_refs"`
	ReadMinutes   int32             `json:"read_minutes"`
	Published     bool              `json:"published"`
	HasChildren   bool              `json:"has_children,omitempty"`
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
	CoverHue      string   `json:"cover_hue"`
	Visibility    string   `json:"visibility"`
	LockedBody    string   `json:"locked_body"`
	ParentID      string   `json:"parent_id"`
	Tags          []string `json:"tags"`
	CrossRefs     []string `json:"cross_refs"`
	Publish       bool     `json:"publish"`
}

// MountWritings 挂 /writings 子路由。
//
// 列出 / 发布 / 取消发布 / 删除的能力来自出站收口；save 还没搬 —— 它这边是 multipart
// （内联图片跟表单一起传），MCP 那边是一串 URL，字节流进不了 JSON op。要并成一个 op，
// 得先把「上传素材」拆成独立一步，那会动到编辑器的保存路径。
func (h *Handlers) MountWritings(r chi.Router) {
	face := h.WritingsAdmin.Face
	r.Route("/writings", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "writings.list", emptyArgs, jsonOK))
		r.Get("/tree", h.treeWritings())
		r.Get("/page", h.pageWritings())
		r.Post("/", h.createAdminWriting())
		r.Patch("/{id}", h.updateAdminWriting())
		r.Post("/{writing_id}/publish",
			h.dispatchOp(face, "writings.publish", urlParamArgs("writing_id"), jsonOK))
		r.Post("/{writing_id}/unpublish",
			h.dispatchOp(face, "writings.unpublish", urlParamArgs("writing_id"), jsonOK))
		r.Delete("/{writing_id}",
			h.dispatchOp(face, "writings.delete", urlParamArgs("writing_id"), noContent))
	})
}

func toWritingViewResolved(r *http.Request, h *Handlers, wg *corpus.Writing) writingView {
	v := toWritingView(wg)
	v.AssetURLs = resolveWritingAssetURLs(r, h, wg)
	return v
}

func resolveWritingAssetURLs(
	r *http.Request, h *Handlers, wg *corpus.Writing,
) map[string]string {
	coverID := wg.CoverImageAssetID()
	var coverPtr *string
	if coverID != "" {
		coverPtr = &coverID
	}
	ids := corpus.WritingAssetIDs(wg.Body(), coverPtr)
	urls, err := corpus.ResolveAssetURLs(
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
func writingParentIDOr(wg *corpus.Writing) string {
	pid, _ := wg.ParentID()
	return pid
}

func toWritingView(wg *corpus.Writing) writingView {
	var pubAtPtr *time.Time
	if pub, ok := wg.PublishedAt(); ok {
		cp := pub
		pubAtPtr = &cp
	}
	return writingView{
		ID: wg.ID(), Slug: wg.Slug(), Title: wg.Title(), Excerpt: wg.Excerpt(),
		BodyMD:        wg.Body(),
		Preview:       corpus.LeadLine(wg.Body(), excerptMaxLen), // clean lead (F-R-1 class)
		CoverHeadline: wg.CoverHeadline(),
		CoverHue:      wg.CoverHue(), CoverImageAssetID: wg.CoverImageAssetID(),
		Tags: wg.Tags(), Visibility: wg.VisibilityMode(), CrossRefs: wg.CrossRefs(),
		Path: wg.Path(), ReadMinutes: wg.ReadMinutes(), LockedBody: wg.LockedBody(),
		ParentID:    writingParentIDOr(wg),
		Published:   wg.IsPublished(),
		PublishedAt: corpus.PublishedAtRFC3339(pubAtPtr),
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
	wg, err := corpus.SaveWriting(ctx, sc.H.WritingsAdmin.WritingsTx, in)
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
	ownerID, writingID string, req *writingSaveRequest, files []corpus.FileInput,
) *corpus.SaveWritingInput {
	return &corpus.SaveWritingInput{
		OwnerID: ownerID, WritingID: writingID, Slug: req.Slug, Title: req.Title,
		Excerpt: req.Excerpt, BodyMD: req.BodyMD,
		CoverImageRef: req.CoverImageRef, CoverHeadline: req.CoverHeadline,
		CoverHue:   req.CoverHue,
		Visibility: req.Visibility, LockedBody: req.LockedBody,
		Tags: req.Tags, CrossRefs: req.CrossRefs, Files: files,
		ParentID: req.ParentID, Publish: req.Publish,
	}
}

var saveWritingErrCases = []apierr.Case{
	{Match: apierr.ErrEmptyField, Envelope: envBadReq("owner_id, slug, title required")},
	{Match: corpus.ErrWritingSlugTaken, Envelope: apierr.Envelope{
		Status: http.StatusConflict, Code: "writing_slug_taken",
		Message: "writing slug already taken",
	}},
	{Match: corpus.ErrParentNotFound, Envelope: envBadReq("parent writing not found")},
	{Match: corpus.ErrParentCycle, Envelope: envBadReq("parent would create a cycle")},
}

func handleSaveWritingErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, saveWritingErrCases)
	if env.Status >= http.StatusInternalServerError {
		log.Error("save writing", "err", err)
	}
	writeError(log, w, env)
}

func writeSavedWriting(
	r *http.Request, h *Handlers, w http.ResponseWriter, wg *corpus.Writing, statusCode int,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(toWritingViewResolved(r, h, wg)); err != nil {
		logEncodeErr(h.Log, "encode writing", err)
	}
}
