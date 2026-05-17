// tokens.go —— /api/admin/tokens CRUD endpoints。
// POST 返回明文一次；GET list 只返回 metadata；DELETE 硬删。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/usecases"
)

type createTokenRequest struct {
	Name string `json:"name"`
}

type createTokenResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Plaintext string `json:"plaintext"`
	CreatedAt string `json:"created_at"`
}

type listTokenItem struct {
	LastUsedAt *string `json:"last_used_at"`
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	CreatedAt  string  `json:"created_at"`
}

// MountTokens 挂 /api/admin/tokens 子路由。
func (h *Handlers) MountTokens(r chi.Router) {
	r.Get("/", h.listTokens())
	r.Post("/", h.createToken())
	r.Delete("/{id}", h.deleteToken())
}

func (h *Handlers) listTokens() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		tokens, err := h.APITokens.Tokens.ListByOwner(r.Context(), ownerID)
		if err != nil {
			h.Log.Error("list tokens", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeTokensList(h.Log, w, tokens)
	}
}

func writeTokensList(log *slog.Logger, w http.ResponseWriter, tokens []domain.APIToken) {
	items := make([]listTokenItem, 0, len(tokens))
	for i := range tokens {
		items = append(items, toListItem(&tokens[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode tokens list", "err", err)
	}
}

func toListItem(t *domain.APIToken) listTokenItem {
	item := listTokenItem{
		ID:        t.ID,
		Name:      t.Name,
		CreatedAt: t.CreatedAt.Format(time.RFC3339),
	}
	if t.LastUsedAt != nil {
		s := t.LastUsedAt.Format(time.RFC3339)
		item.LastUsedAt = &s
	}
	return item
}

func (h *Handlers) createToken() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createTokenRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		out, err := usecases.CreateAPIToken(r.Context(), h.APITokens, ownerID, req.Name)
		if err != nil {
			handleCreateTokenErr(h.Log, w, err)
			return
		}
		writeCreateTokenResp(h.Log, w, &out)
	}
}

func handleCreateTokenErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, []apierr.Case{
		{Match: usecases.ErrEmptyField, Envelope: envBadReq("name is required")},
	})
	if env.Status >= http.StatusInternalServerError {
		log.Error("create token", "err", err)
	}
	writeError(log, w, env)
}

func writeCreateTokenResp(log *slog.Logger, w http.ResponseWriter, out *usecases.CreatedAPIToken) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	resp := createTokenResponse{
		ID:        out.Token.ID,
		Name:      out.Token.Name,
		Plaintext: out.Plaintext,
		CreatedAt: out.Token.CreatedAt.Format(time.RFC3339),
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode create token", "err", err)
	}
}

func (h *Handlers) deleteToken() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		tokenID := chi.URLParam(r, "id")
		if derr := h.APITokens.Tokens.Delete(r.Context(), ownerID, tokenID); derr != nil {
			h.Log.Error("delete token", "err", derr)
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func serverErr() apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}
