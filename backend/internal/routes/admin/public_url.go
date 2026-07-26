// public_url.go —— admin PATCH /api/admin/public-url —— owner 改部署的
// canonical public URL（claim 后改域名时）。
//
// owner.public_url 是 QR / SEO canonical 的单一来源；这是 owner 第二次起
// 修改它的入口（第一次是 claim）。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// PublicURLDeps —— admin public-url endpoint 的依赖（usecase 注入）。
type PublicURLDeps struct {
	PublicURL usecases.PublicURLDeps
}

type updatePublicURLBody struct {
	PublicURL string `json:"public_url"`
}

type updatePublicURLResp struct {
	PublicURL string `json:"public_url"`
}

// MountPublicURL 挂 PATCH /public-url（caller 前缀 /api/admin）。
func (h *Handlers) MountPublicURL(r chi.Router) {
	r.Patch("/public-url", h.updatePublicURL())
}

func (h *Handlers) updatePublicURL() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body updatePublicURLBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		owner, err := usecases.UpdateOwnerPublicURL(
			r.Context(), h.PublicURLAdmin.PublicURL, ownerID, body.PublicURL,
		)
		if err != nil {
			handleUpdatePublicURLErr(h.Log, w, err)
			return
		}
		writePublicURLResp(h.Log, w, &owner)
	}
}

func writePublicURLResp(log *slog.Logger, w http.ResponseWriter, owner *ownerdomain.Owner) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := updatePublicURLResp{PublicURL: owner.PublicURL}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode update public_url", "err", err)
	}
}

func handleUpdatePublicURLErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, usecases.ErrEmptyField) {
		writeError(log, w, envBadReq("public_url is required"))
		return
	}
	if errors.Is(err, usecases.ErrPublicURLInvalid) {
		writeError(log, w, apierr.Envelope{
			Status:  http.StatusBadRequest,
			Code:    "public_url_invalid",
			Message: "public_url must be a full URL with http(s):// scheme",
		})
		return
	}
	log.Error("update public_url", "err", err)
	writeError(log, w, serverErr())
}
