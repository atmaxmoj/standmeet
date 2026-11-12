package jobsadmin

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
)

// sinceBase / sinceBits —— base and bit width for parsing the ?since= seq (a decimal int64).
const (
	sinceBase = 10
	sinceBits = 64
)

// MountScreenAssistant hangs the screen-assistant feed routes off the given router (same auth
// stack as Mount):
//   - GET /screen-assistant/stream?since= —— the feed the desktop cue app pushed, as a Server-Sent
//     Events stream. The page (and /cue) holds it open and is pushed each new event; ?since= is the
//     seq it last saw, so an EventSource reconnect resumes from there.
//   - POST /screen-assistant/viewing —— the phone view (/cue) heartbeats here while on screen; it
//     marks the owner present for a few seconds, which the desktop app reads (assistant.read's
//     phone_present) to hand its display to the phone. Only /cue calls it, so cards open on the
//     computer's admin page never blank the desktop app.
func MountScreenAssistant(r chi.Router, store *cues.Store, log *slog.Logger) {
	r.Get("/screen-assistant/stream", cueStream(store, log))
	r.Post("/screen-assistant/viewing", cueViewing(store, log))
}

// parseSince —— the ?since= cursor (a decimal seq); 0 when absent or malformed (from the start).
func parseSince(r *http.Request) int64 {
	since, err := strconv.ParseInt(r.URL.Query().Get("since"), sinceBase, sinceBits)
	if err != nil {
		return 0
	}
	return since
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
