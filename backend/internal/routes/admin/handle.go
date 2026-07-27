// handle.go —— admin PATCH /api/admin/handle —— owner 改 URL handle。
// 旧 handle 自动写进 handle_aliases，老链接仍可 resolve。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// HandleDeps —— admin handle endpoint 的依赖。
type HandleDeps struct {
	Handle owner.HandleDeps
}

type updateHandleBody struct {
	Handle string `json:"handle"`
}

type updateHandleResp struct {
	Handle string `json:"handle"`
}

// MountHandle 挂 PATCH /handle（caller 前缀 /api/admin）。
func (h *Handlers) MountHandle(r chi.Router) {
	r.Patch("/handle", h.updateHandle())
}

func (h *Handlers) updateHandle() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body updateHandleBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		updated, err := owner.UpdateOwnerHandle(
			r.Context(), h.HandleAdmin.Handle, ownerID, body.Handle,
		)
		if err != nil {
			handleUpdateHandleErr(h.Log, w, err)
			return
		}
		writeHandleResp(h.Log, w, &updated)
	}
}

func writeHandleResp(log *slog.Logger, w http.ResponseWriter, o *owner.Owner) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(updateHandleResp{Handle: o.Handle}); err != nil {
		log.Error("encode update handle", "err", err)
	}
}

func handleUpdateHandleErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, owner.ErrHandleTaken) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusConflict, Code: "handle_taken",
			Message: "that handle is already taken",
		})
		return
	}
	if errors.Is(err, apierr.ErrEmptyField) {
		writeError(log, w, envBadReq(err.Error()))
		return
	}
	log.Error("update handle", "err", err)
	writeError(log, w, serverErr())
}
