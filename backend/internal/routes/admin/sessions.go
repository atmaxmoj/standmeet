// sessions.go — /api/admin/sessions: the owner's active login sessions.
//
// The panel shows every place the owner is currently signed in (IP, device, when)
// and lets them revoke any one — the per-session counterpart to /me/logout. A raw
// session token is never exposed; each row carries a random public ID, and revoke
// is scoped to the requesting owner (RevokeByID only ever looks in that owner's
// index), so one owner can never name another's session.

package admin

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
)

// sessionView — one active session as the panel sees it. `current` marks the
// session making this very request, so the UI can label it and turn its revoke
// button into "sign out here".
type sessionView struct {
	CreatedAt time.Time `json:"created_at"`
	ID        string    `json:"id"`
	IPAddress string    `json:"ip_address"`
	UserAgent string    `json:"user_agent"`
	Current   bool      `json:"current"`
}

// MountSessions mounts /sessions (caller prefix /api/admin, already behind WithOwner).
func (h *Handlers) MountSessions(r chi.Router) {
	r.Route("/sessions", func(r chi.Router) {
		r.Get("/", h.listSessions())
		r.Delete("/{id}", h.revokeSession())
	})
}

func (h *Handlers) listSessions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		current, _ := authmw.SessionFrom(r.Context())
		sessions, err := h.Auth.Sessions.ListByOwner(r.Context(), ownerID)
		if err != nil {
			h.Log.Error("list sessions", "err", err)
			writeError(h.Log, w, apierr.Envelope{
				Status: http.StatusInternalServerError, Code: "server_error",
				Message: "internal error",
			})
			return
		}
		writeJSON(h.Log, w, sessionViews(sessions, current.ID))
	}
}

func sessionViews(sessions []session.OwnerSessionData, currentID string) []sessionView {
	views := make([]sessionView, 0, len(sessions))
	for i := range sessions {
		views = append(views, sessionView{
			ID:        sessions[i].ID,
			IPAddress: sessions[i].IPAddress,
			UserAgent: sessions[i].UserAgent,
			CreatedAt: sessions[i].CreatedAt,
			Current:   sessions[i].ID == currentID,
		})
	}
	return views
}

func (h *Handlers) revokeSession() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		err := h.Auth.Sessions.RevokeByID(r.Context(), ownerID, chi.URLParam(r, "id"))
		if errors.Is(err, session.ErrSessionNotFound) {
			writeError(h.Log, w, apierr.Envelope{
				Status: http.StatusNotFound, Code: "not_found", Message: "no such session",
			})
			return
		}
		if err != nil {
			h.Log.Error("revoke session", "err", err)
			writeError(h.Log, w, apierr.Envelope{
				Status: http.StatusInternalServerError, Code: "server_error",
				Message: "internal error",
			})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
