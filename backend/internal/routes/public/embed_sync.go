// embed_sync.go —— GET /api/v1/embeds/{kid}: the embed's sync mode, read by the site behind it
// (docs/design/event-bus-outbox-webhooks.md, *Embed sync mode*). The embed owns the fact; the site
// keeps no setting of its own. The kid is already public (it is in the embed snippet), and nothing
// secret is returned. This face never touches the domain (check-routes-via-dispatcher): the
// composition root hands it EmbedSyncMode, whose errors are display errors.

package public

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

type embedSyncView struct {
	KeyID    string `json:"kid"`
	SyncMode string `json:"sync_mode"`
}

func (h *Handlers) getEmbedSync() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kid := chi.URLParam(r, "kid")
		mode, err := h.EmbedSyncMode(r.Context(), kid)
		if err != nil {
			h.writeEmbedSyncErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		// The site re-reads at most once a minute; a mode change reaches it within that.
		w.Header().Set("Cache-Control", "public, max-age=60")
		view := embedSyncView{KeyID: kid, SyncMode: mode}
		if eerr := json.NewEncoder(w).Encode(view); eerr != nil {
			h.Log.Error("encode embed sync mode", "err", eerr)
		}
	}
}

func (h *Handlers) writeEmbedSyncErr(w http.ResponseWriter, err error) {
	env := apierr.Classify(err, nil)
	if env.Status >= http.StatusInternalServerError {
		h.Log.Error("embed sync mode", "err", err)
	}
	writeError(h.Log, w, env)
}
