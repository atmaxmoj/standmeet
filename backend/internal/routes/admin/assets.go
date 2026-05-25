// assets.go —— admin /assets endpoint：multipart upload + list + delete。
// 真 bytes 落 MinIO；本路由层只处理 multipart parse + 调 usecase。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"mime/multipart"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/usecases"
)

const (
	// uploadFieldName —— multipart form field name; admin UI 也走这个。
	uploadFieldName = "file"
	// maxUploadBytes —— 单文件 25MB；超大附件后续再说 (用 MinIO 直传)。
	maxUploadBytes = 25 << 20
)

// AssetsAdminDeps —— admin assets handlers 依赖。
type AssetsAdminDeps struct {
	Assets usecases.AssetsDeps
}

type assetView struct {
	CreatedAt        string `json:"created_at"`
	ID               string `json:"id"`
	URL              string `json:"url"`
	ContentType      string `json:"content_type"`
	OriginalFilename string `json:"original_filename"`
	SHA256           string `json:"sha256"`
	SizeBytes        int64  `json:"size_bytes"`
}

// MountAssets 挂 /assets。
func (h *Handlers) MountAssets(r chi.Router) {
	r.Route("/assets", func(r chi.Router) {
		r.Get("/", h.listAssets())
		r.Post("/", h.uploadAsset())
		r.Get("/orphans", h.listOrphans())
		r.Delete("/{id}", h.deleteAsset())
	})
}

// listOrphans —— 扫所有 post.body_md 引用的 asset ID，跟 assets 表对差集
// 返没人引的 asset list。owner-scoped；后续 wiki/output/custom_page 也扫。
func (h *Handlers) listOrphans() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		ids, err := usecases.FindOrphanAssets(
			r.Context(),
			h.AssetsAdmin.Assets.Repo,
			h.PostsAdmin.Posts.Posts,
			ownerID,
		)
		if err != nil {
			logEncodeErr(h.Log, "list orphan assets", err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if encErr := json.NewEncoder(w).Encode(orphanResp{Orphans: ids}); encErr != nil {
			logEncodeErr(h.Log, "encode orphans", encErr)
		}
	}
}

type orphanResp struct {
	Orphans []string `json:"orphans"`
}

func (h *Handlers) uploadAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runUploadAsset(r, h, w)
	}
}

func runUploadAsset(r *http.Request, h *Handlers, w http.ResponseWriter) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	file, header, ferr := r.FormFile(uploadFieldName)
	if ferr != nil {
		writeError(h.Log, w, envBadReq("missing or invalid file field"))
		return
	}
	defer closeUploadFile(file)
	doUploadAsset(r, h, w, file, header)
}

func closeUploadFile(file multipart.File) {
	if cerr := file.Close(); cerr != nil {
		_ = cerr
	}
}

func doUploadAsset(
	r *http.Request, h *Handlers, w http.ResponseWriter,
	file multipart.File, header *multipart.FileHeader,
) {
	in := buildUploadAssetInput(r, file, header)
	res, err := usecases.UploadAsset(r.Context(), h.AssetsAdmin.Assets, in)
	if err != nil {
		handleUploadAssetErr(h.Log, w, err)
		return
	}
	writeUploadedAsset(h.Log, w, &res)
}

func buildUploadAssetInput(
	r *http.Request, file multipart.File, header *multipart.FileHeader,
) *usecases.UploadAssetInput {
	return &usecases.UploadAssetInput{
		Body: file, OwnerID: middleware.OwnerIDFrom(r.Context()),
		ContentType:      contentTypeOf(header),
		OriginalFilename: header.Filename,
		SizeBytes:        header.Size,
	}
}

// contentTypeOf —— 优先 multipart Content-Type header；空回退
// "application/octet-stream"。
func contentTypeOf(header *multipart.FileHeader) string {
	if header == nil {
		return "application/octet-stream"
	}
	if ct := header.Header.Get("Content-Type"); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

const timeFmt = time.RFC3339

func handleUploadAssetErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, usecases.ErrEmptyField) {
		writeError(log, w, envBadReq("owner_id missing"))
		return
	}
	logEncodeErr(log, "upload asset", err)
	writeError(log, w, serverErr())
}

func writeUploadedAsset(
	log *slog.Logger, w http.ResponseWriter, res *usecases.UploadAssetResult,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(assetView{
		ID: res.Asset.ID, URL: res.PublicURL,
		ContentType: res.Asset.ContentType, SizeBytes: res.Asset.SizeBytes,
		SHA256: res.Asset.SHA256, OriginalFilename: res.Asset.OriginalFilename,
		CreatedAt: res.Asset.CreatedAt.Format(timeFmt),
	}); err != nil {
		logEncodeErr(log, "encode asset", err)
	}
}

func (h *Handlers) listAssets() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := usecases.ListAssets(r.Context(), h.AssetsAdmin.Assets, ownerID, 0)
		if err != nil {
			logEncodeErr(h.Log, "list assets", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeAssetsList(r, h, w, rows)
	}
}

func writeAssetsList(
	r *http.Request, h *Handlers, w http.ResponseWriter, rows []domain.Asset,
) {
	items := make([]assetView, 0, len(rows))
	for i := range rows {
		items = append(items, toAssetView(r, h, &rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(h.Log, "encode assets", err)
	}
}

func toAssetView(r *http.Request, h *Handlers, a *domain.Asset) assetView {
	url, perr := h.AssetsAdmin.Assets.Storage.PresignedGetURL(r.Context(), a.StorageKey)
	if perr != nil {
		h.Log.Error("presign asset url", "asset_id", a.ID, "err", perr)
	}
	return assetView{
		ID: a.ID, URL: url, ContentType: a.ContentType,
		SizeBytes: a.SizeBytes, SHA256: a.SHA256,
		OriginalFilename: a.OriginalFilename,
		CreatedAt:        a.CreatedAt.Format(timeFmt),
	}
}

func (h *Handlers) deleteAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		assetID := chi.URLParam(r, "id")
		err := usecases.DeleteAsset(r.Context(), h.AssetsAdmin.Assets, ownerID, assetID)
		if err != nil {
			handleDeleteAssetErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDeleteAssetErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, domain.ErrAssetNotFound) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "asset_not_found",
			Message: "asset not found",
		})
		return
	}
	logEncodeErr(log, "delete asset", err)
	writeError(log, w, serverErr())
}
