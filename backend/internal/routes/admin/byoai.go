// byoai.go —— PUT /api/admin/byoai。owner 调一次写三字段：enabled /
// providers / public_blurb。返回更新后的 me-shape，前端可以直接 swap。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

// BYOAIDeps —— admin BYOAI handlers 依赖。
type BYOAIDeps struct {
	BYOAI owner.BYOAIDeps
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
		settings, err := owner.UpdateBYOAI(
			r.Context(), h.BYOAI.BYOAI, &owner.UpdateBYOAIInputReq{
				OwnerID: ownerID, Enabled: req.Enabled,
				Providers: req.Providers, Blurb: req.Blurb,
			})
		if err != nil {
			handleBYOAIErr(h.Log, w, err)
			return
		}
		writeSettings(h.Log, w, &settings)
	}
}

// writeSettings —— byoai / ai-provider 更新成功后回 settings 一片，前端
// sessionStore.refresh 之外可以更直接地把新值 swap 进缓存。
func writeSettings(
	log *slog.Logger, w http.ResponseWriter, settings *owner.Settings,
) {
	providers := settings.BYOAI.Providers
	if providers == nil {
		providers = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if encErr := json.NewEncoder(w).Encode(settingsView{
		AI: aiSettingsView{
			Provider: settings.AI.Provider, KeyConfigured: settings.AI.KeyConfigured,
		},
		BYOAI: byoaiSettingsView{
			Enabled: settings.BYOAI.Enabled, Providers: providers,
			PublicBlurb: settings.BYOAI.PublicBlurb,
		},
	}); encErr != nil {
		log.Error("encode settings", "err", encErr)
	}
}

func handleBYOAIErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, owner.ErrOwnerNotFound) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusUnauthorized, Code: "unauthorized", Message: "owner not found",
		})
		return
	}
	log.Error("update byoai", "err", err)
	writeError(log, w, serverErr())
}
