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

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// AIProviderDeps —— admin ai-provider 路由依赖。
type AIProviderDeps struct {
	AI usecases.AIProviderDeps
}

type aiProviderRequest struct {
	Provider  string `json:"provider"`
	KeyChange string `json:"key_change"` // "keep" | "set" | "clear"
	Key       string `json:"key,omitempty"`
}

type aiProviderResp struct {
	Provider      string `json:"provider"`
	KeyConfigured bool   `json:"key_configured"`
}

// MountAIProvider 挂 PATCH /ai-provider（caller 前缀 /api/admin）。
func (h *Handlers) MountAIProvider(r chi.Router) {
	r.Patch("/ai-provider", h.updateAIProvider())
}

func (h *Handlers) updateAIProvider() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body aiProviderRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		owner, err := usecases.UpdateOwnerAIProvider(r.Context(), h.AIProviderAdmin.AI,
			&usecases.UpdateOwnerAIProviderInput{
				OwnerID: ownerID, Provider: body.Provider,
				KeyChange: parseKeyChange(body.KeyChange), Key: body.Key,
			})
		if err != nil {
			handleAIProviderErr(h.Log, w, err)
			return
		}
		writeAIProviderResp(h.Log, w, &owner)
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
	if errors.Is(err, usecases.ErrEmptyField) {
		writeError(log, w, envBadReq(err.Error()))
		return
	}
	logEncodeErr(log, "update ai provider", err)
	writeError(log, w, serverErr())
}

func writeAIProviderResp(log *slog.Logger, w http.ResponseWriter, o *domain.Owner) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(aiProviderResp{
		Provider: o.AIProvider, KeyConfigured: o.AIProviderKeyConfigured,
	}); err != nil {
		logEncodeErr(log, "encode ai provider resp", err)
	}
}
