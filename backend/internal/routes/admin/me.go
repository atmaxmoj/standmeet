// me.go —— GET /api/admin/me 返回当前 owner profile。
// 需要 WithOwner middleware（路由组挂的）。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
)

type meResponse struct {
	OwnerID                 string   `json:"owner_id"`
	Email                   string   `json:"email"`
	Handle                  string   `json:"handle"`
	FullName                string   `json:"full_name"`
	BYOAIPublicBlurb        string   `json:"byoai_public_blurb"`
	AIProvider              string   `json:"ai_provider"`
	BYOAIProviders          []string `json:"byoai_providers"`
	BYOAIEnabled            bool     `json:"byoai_enabled"`
	AIProviderKeyConfigured bool     `json:"ai_provider_key_configured"`
}

func (h *Handlers) me() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		owner, err := h.Auth.Login.Owners.GetByID(r.Context(), ownerID)
		if err != nil {
			handleMeErr(h.Log, w, err)
			return
		}
		writeMe(h.Log, w, &owner)
	}
}

func writeMe(log *slog.Logger, w http.ResponseWriter, owner *domain.Owner) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	providers := owner.BYOAIProviders
	if providers == nil {
		providers = []string{}
	}
	resp := meResponse{
		OwnerID: owner.ID, Email: owner.Email,
		Handle: owner.Handle, FullName: owner.FullName,
		BYOAIEnabled:            owner.BYOAIEnabled,
		BYOAIProviders:          providers,
		BYOAIPublicBlurb:        owner.BYOAIPublicBlurb,
		AIProvider:              owner.AIProvider,
		AIProviderKeyConfigured: owner.AIProviderKeyConfigured,
	}
	if encErr := json.NewEncoder(w).Encode(resp); encErr != nil {
		log.Error("encode me response", "err", encErr)
	}
}

func handleMeErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, domain.ErrOwnerNotFound) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusUnauthorized, Code: "unauthorized", Message: "owner not found",
		})
		return
	}
	log.Error("me failed", "err", err)
	writeError(log, w, apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	})
}
