// keypairs.go —— /api/admin/keypairs CRUD endpoints。
// POST → 一次性返 {key_id, private_key_pem, label, created_at}
// GET → list metadata only
// DELETE /:key_id → hard delete (revoke)

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

// KeypairsAdminDeps —— admin keypairs handlers 需要的依赖。
type KeypairsAdminDeps struct {
	Deps owner.KeypairDeps
	Log  *slog.Logger
}

type createKeypairRequest struct {
	Label string `json:"label"`
}

type createKeypairResponse struct {
	KeyID         string `json:"key_id"`
	PrivateKeyPEM string `json:"private_key_pem"`
	Label         string `json:"label"`
	CreatedAt     string `json:"created_at"`
}

type listKeypairItem struct {
	LastUsedAt *string `json:"last_used_at"`
	KeyID      string  `json:"key_id"`
	Label      string  `json:"label"`
	CreatedAt  string  `json:"created_at"`
}

// MountKeypairs 挂 /api/admin/keypairs 子路由。
func (h *Handlers) MountKeypairs(r chi.Router) {
	r.Get("/", h.listKeypairs())
	r.Post("/", h.createKeypair())
	r.Delete("/{key_id}", h.deleteKeypair())
}

func (h *Handlers) listKeypairs() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		list, err := owner.ListKeypairs(r.Context(), h.KeypairsAdmin.Deps, ownerID)
		if err != nil {
			h.Log.Error("list keypairs", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeKeypairsList(h.Log, w, list)
	}
}

func writeKeypairsList(
	log *slog.Logger, w http.ResponseWriter, list []owner.KeypairMetadata,
) {
	items := make([]listKeypairItem, 0, len(list))
	for i := range list {
		items = append(items, toListKeypairItem(&list[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode keypairs list", "err", err)
	}
}

func toListKeypairItem(k *owner.KeypairMetadata) listKeypairItem {
	item := listKeypairItem{
		KeyID:     k.KeyID,
		Label:     k.Label,
		CreatedAt: k.CreatedAt.Format(time.RFC3339),
	}
	if k.LastUsedAt != nil {
		s := k.LastUsedAt.Format(time.RFC3339)
		item.LastUsedAt = &s
	}
	return item
}

func (h *Handlers) createKeypair() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createKeypairRequest
		if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
			writeError(h.Log, w, apierr.Envelope{
				Status: http.StatusBadRequest, Code: "invalid_body",
				Message: "invalid json body",
			})
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		created, err := owner.CreateKeypair(r.Context(), h.KeypairsAdmin.Deps,
			&owner.CreateKeypairInputReq{OwnerID: ownerID, Label: req.Label})
		if err != nil {
			writeError(h.Log, w, createKeypairEnv(err))
			return
		}
		writeCreatedKeypair(h.Log, w, &created)
	}
}

func createKeypairEnv(err error) apierr.Envelope {
	if errors.Is(err, apierr.ErrEmptyField) {
		return apierr.Envelope{
			Status: http.StatusBadRequest, Code: "label_required",
			Message: "label is required",
		}
	}
	return serverErr()
}

func writeCreatedKeypair(
	log *slog.Logger, w http.ResponseWriter, c *owner.CreatedKeypair,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	resp := createKeypairResponse{
		KeyID:         c.Record.KeyID,
		PrivateKeyPEM: c.PrivateKeyPEM,
		Label:         c.Record.Label,
		CreatedAt:     c.Record.CreatedAt.Format(time.RFC3339),
	}
	if err := json.NewEncoder(w).Encode(&resp); err != nil {
		log.Error("encode created keypair", "err", err)
	}
}

func (h *Handlers) deleteKeypair() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		keyID := chi.URLParam(r, "key_id")
		err := owner.DeleteKeypair(r.Context(), h.KeypairsAdmin.Deps, ownerID, keyID)
		if err != nil {
			writeError(h.Log, w, deleteKeypairEnv(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func deleteKeypairEnv(err error) apierr.Envelope {
	if errors.Is(err, owner.ErrKeypairUnauthorized) {
		return apierr.Envelope{
			Status: http.StatusNotFound, Code: "keypair_not_found",
			Message: "keypair not found",
		}
	}
	return serverErr()
}
