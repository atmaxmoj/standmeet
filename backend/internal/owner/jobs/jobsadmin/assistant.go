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

// MountScreenAssistant hangs GET /screen-assistant/events off the given router (same auth stack
// as Mount): the feed the desktop cue app pushed (assistant.push), after the last seq the page
// saw (?since=). The page polls it.
func MountScreenAssistant(r chi.Router, store *cues.Store, log *slog.Logger) {
	r.Get("/screen-assistant/events", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("since")
		since, _ := strconv.ParseInt(q, 10, 64) //nolint:errcheck // absent = 0
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
	})
}
