// byoai.go —— PUT /api/admin/byoai。owner 调一次写三字段：enabled /
// providers / public_blurb。返回更新后的 me-shape，前端可以直接 swap。

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

// BYOAIDeps —— admin BYOAI handlers 依赖。
type BYOAIDeps struct {
	BYOAI usecases.BYOAIDeps
}

type byoaiRequest struct {
	Blurb     string   `json:"blurb"`
	Providers []string `json:"providers"`
	Enabled   bool     `json:"enabled"`
}

// MountBYOAI 挂 PUT /byoai。
func (h *Handlers) MountBYOAI(r chi.Router) {
	r.Put("/byoai", h.putBYOAI())
}

func (h *Handlers) putBYOAI() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		var req byoaiRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		owner, err := usecases.UpdateBYOAI(r.Context(), h.BYOAI.BYOAI, &usecases.UpdateBYOAIInput{
			OwnerID: ownerID, Enabled: req.Enabled,
			Providers: req.Providers, Blurb: req.Blurb,
		})
		if err != nil {
			handleBYOAIErr(h.Log, w, err)
			return
		}
		writeMe(h.Log, w, &owner)
	}
}

func handleBYOAIErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, domain.ErrOwnerNotFound) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusUnauthorized, Code: "unauthorized", Message: "owner not found",
		})
		return
	}
	log.Error("update byoai", "err", err)
	writeError(log, w, serverErr())
}
