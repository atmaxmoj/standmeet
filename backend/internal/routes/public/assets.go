// assets.go —— public GET /api/v1/assets/{id}：查 PG → 即时 presign MinIO
// 对象 → 302 redirect 给浏览器。owner_id 不暴露在 URL，capability 模型：
// 拿到 asset id 就能拉，posts/wiki 引用时就把 id 嵌进 markdown / blocks。
// 后续如需 ACL，可以查 asset 所属 owner_id 与 visitor session.OwnerID 比对。

package public

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// AssetHandlers —— public assets endpoint。
type AssetHandlers struct {
	Deps usecases.AssetsDeps
	Log  *slog.Logger
}

// Mount 挂 /assets。caller 前缀 /api/v1。
func (h *AssetHandlers) Mount(r chi.Router) {
	r.Get("/assets/{id}", h.getAsset())
}

func (h *AssetHandlers) getAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		assetID := chi.URLParam(r, "id")
		res, err := usecases.ResolveAssetURL(r.Context(), h.Deps, assetID)
		if err != nil {
			handleGetAssetErr(h.Log, w, err)
			return
		}
		// 302 because the URL has TTL; cache control left to browser default.
		w.Header().Set("Location", res.URL)
		w.WriteHeader(http.StatusFound)
	}
}

func handleGetAssetErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, domain.ErrAssetNotFound) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "asset_not_found",
			Message: "asset not found",
		})
		return
	}
	log.Error("get asset", "err", err)
	writeError(log, w, apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error",
		Message: "internal error",
	})
}
