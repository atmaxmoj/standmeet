package jobsadmin

import (
	"encoding/json"
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
//   - GET /screen-assistant/events?since= —— the feed the desktop cue app pushed, after the seq
//     the page last saw. The page (and /cue) polls it.
//   - POST /screen-assistant/viewing —— the phone view (/cue) heartbeats here while on screen; it
//     marks the owner present for a few seconds, which the desktop app reads (assistant.read's
//     phone_present) to hand its display to the phone. Only /cue calls it, so cards open on the
//     computer's admin page never blank the desktop app.
func MountScreenAssistant(r chi.Router, store *cues.Store, log *slog.Logger) {
	r.Get("/screen-assistant/events", cueEvents(store, log))
	r.Post("/screen-assistant/viewing", cueViewing(store, log))
}

func cueEvents(store *cues.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		since, perr := strconv.ParseInt(r.URL.Query().Get("since"), sinceBase, sinceBits)
		if perr != nil {
			since = 0 // absent or malformed: from the start
		}
		events, err := store.Since(r.Context(), authmw.OwnerIDFrom(r.Context()), since)
		if err != nil {
			log.Error("list cues", logErrKey, err)
			writeServerErr(log, w)
			return
		}
		w.Header().Set(ctHeader, ctJSON)
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(events); eerr != nil {
			log.Error("encode cues", logErrKey, eerr)
		}
	}
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
