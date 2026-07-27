// me.go —— GET /api/admin/me 返回当前 owner profile + settings。
// 需要 WithOwner middleware（路由组挂的）。
//
// Response shape:
//   { owner: { ... identity }, settings: { ai: ..., byoai: ... } }
// 跟 owner.Owner / owner.Settings 1:1 对齐。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

type ownerView struct {
	OwnerID   string `json:"owner_id"`
	Email     string `json:"email"`
	Handle    string `json:"handle"`
	FullName  string `json:"full_name"`
	PublicURL string `json:"public_url"`
}

type aiSettingsView struct {
	Provider      string `json:"provider"`
	Endpoint      string `json:"endpoint"`
	Model         string `json:"model"`
	KeyConfigured bool   `json:"key_configured"`
}

type byoaiSettingsView struct {
	PublicBlurb string   `json:"public_blurb"`
	Providers   []string `json:"providers"`
	Enabled     bool     `json:"enabled"`
}

type settingsView struct {
	AI    aiSettingsView    `json:"ai"`
	BYOAI byoaiSettingsView `json:"byoai"`
}

type meResponse struct {
	Owner    ownerView    `json:"owner"`
	Settings settingsView `json:"settings"`
}

func (h *Handlers) me() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		ownerRow, err := h.Auth.Login.Owners.GetByID(r.Context(), ownerID)
		if err != nil {
			handleMeErr(h.Log, w, err)
			return
		}
		settings, serr := h.Auth.Login.Owners.GetSettings(r.Context(), ownerID)
		if serr != nil {
			handleMeErr(h.Log, w, serr)
			return
		}
		writeMe(h.Log, w, &ownerRow, &settings)
	}
}

func writeMe(
	log *slog.Logger, w http.ResponseWriter,
	o *owner.Owner, settings *owner.Settings,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if encErr := json.NewEncoder(w).Encode(toMeResponse(o, settings)); encErr != nil {
		log.Error("encode me response", "err", encErr)
	}
}

func toMeResponse(o *owner.Owner, settings *owner.Settings) meResponse {
	providers := settings.BYOAI.Providers
	if providers == nil {
		providers = []string{}
	}
	return meResponse{
		Owner: ownerView{
			OwnerID: o.ID, Email: o.Email,
			Handle: o.Handle, FullName: o.FullName,
			PublicURL: o.PublicURL,
		},
		Settings: settingsView{
			AI: aiSettingsView{
				Provider:      settings.AI.Provider,
				Endpoint:      settings.AI.Endpoint,
				Model:         settings.AI.Model,
				KeyConfigured: settings.AI.KeyConfigured,
			},
			BYOAI: byoaiSettingsView{
				Enabled:     settings.BYOAI.Enabled,
				Providers:   providers,
				PublicBlurb: settings.BYOAI.PublicBlurb,
			},
		},
	}
}

func handleMeErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, owner.ErrOwnerNotFound) {
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
