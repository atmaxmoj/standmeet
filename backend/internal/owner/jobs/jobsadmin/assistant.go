package jobsadmin

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
)

// MountScreenAssistant hangs the screen-assistant feed routes off the given router (same auth
// stack as Mount):
//   - GET /screen-assistant/stream —— the feed the desktop cue app pushed, as a Server-Sent Events
//     stream. The page (and /cue) holds it open and is sent the current card set when it changes,
//     so the phone mirrors what to show now (an empty set between interviews clears it).
//   - POST /screen-assistant/viewing —— the phone view (/cue) heartbeats here while on screen; it
//     marks the owner present for a few seconds, which the desktop app reads (assistant.read's
//     phone_present) to hand its display to the phone. Only /cue calls it, so cards open on the
//     computer's admin page never blank the desktop app.
func MountScreenAssistant(r chi.Router, store *cues.Store, log *slog.Logger) {
	r.Get("/screen-assistant/stream", cueStream(store, log))
	r.Post("/screen-assistant/viewing", cueViewing(store, log))
}

func cueViewing(store *cues.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := store.MarkViewing(r.Context(), authmw.OwnerIDFrom(r.Context())); err != nil {
			log.Error("mark cue viewing", logErrKey, err)
			writeServerErr(log, w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
