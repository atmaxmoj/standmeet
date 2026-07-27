// ai_provider.go —— admin PATCH /api/admin/ai-provider —— owner 设自己的 AI
// provider + 明文 key（落盘前 AES-GCM 加密）。响应只回 provider + 是否设
// key 的布尔（不回明文，避免 audit log 漏）。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// AIProviderDeps —— admin ai-provider 路由依赖。
type AIProviderDeps struct {
	AI usecases.AIProviderDeps
}

type aiProviderRequest struct {
	Provider  string `json:"provider"`
	Endpoint  string `json:"endpoint"`   // base URL (preset 默认 / owner 自托管必填)
	Model     string `json:"model"`      // model id (preset 默认 / owner 可改)
	KeyChange string `json:"key_change"` // "keep" | "set" | "clear"
	Key       string `json:"key,omitempty"`
}

// MountAIProvider 挂 PATCH /ai-provider + GET /ai-provider/presets（caller
// 前缀 /api/admin）。presets 端点给 admin UI 列下拉 + 填默认 endpoint/model。
func (h *Handlers) MountAIProvider(r chi.Router) {
	r.Patch("/ai-provider", h.updateAIProvider())
	r.Get("/ai-provider/presets", h.listAIProviderPresets())
}

type presetView struct {
	Name      string `json:"name"`
	Label     string `json:"label"`
	BaseURL   string `json:"base_url"`
	KeyPrefix string `json:"key_prefix"`
}

func (h *Handlers) listAIProviderPresets() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		presets := inference.All()
		out := make([]presetView, 0, len(presets))
		for i := range presets {
			out = append(out, presetView{
				Name: presets[i].Name, Label: presets[i].Label,
				BaseURL: presets[i].BaseURL, KeyPrefix: presets[i].KeyPrefix,
			})
		}
		writePresetList(h.Log, w, out)
	}
}

func writePresetList(log *slog.Logger, w http.ResponseWriter, items []presetView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode presets", "err", err)
	}
}

func (h *Handlers) updateAIProvider() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body aiProviderRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		settings, err := usecases.UpdateOwnerAIProvider(r.Context(), h.AIProviderAdmin.AI,
			&usecases.UpdateOwnerAIProviderInput{
				OwnerID: ownerID, Provider: body.Provider,
				Endpoint: body.Endpoint, Model: body.Model,
				KeyChange: parseKeyChange(body.KeyChange), Key: body.Key,
			})
		if err != nil {
			handleAIProviderErr(h.Log, w, err)
			return
		}
		writeSettings(h.Log, w, &settings)
	}
}

func parseKeyChange(s string) usecases.KeyChange {
	switch s {
	case "set":
		return usecases.KeySet
	case "clear":
		return usecases.KeyClear
	default:
		return usecases.KeyKeep
	}
}

func handleAIProviderErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, apierr.ErrEmptyField) {
		writeError(log, w, envBadReq(err.Error()))
		return
	}
	logEncodeErr(log, "update ai provider", err)
	writeError(log, w, serverErr())
}
