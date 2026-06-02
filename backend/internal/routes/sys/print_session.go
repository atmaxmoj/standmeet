// print_session.go —— GET /internal/print-session/{token} — gotenberg's
// Chromium calls this from inside the docker network to pick up the
// payload it should render. One-shot: Take() deletes the entry.
//
// Why /internal: this endpoint is unauthenticated by design (gotenberg
// has no session cookie) but the route prefix is reserved for in-cluster
// service-to-service traffic. The token is the only authorization; once
// expired or taken, the data is unreachable.

package sys

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/printsess"
)

// PrintSessionDeps —— smallest dep set for the route.
type PrintSessionDeps struct {
	Store *printsess.Store
	Log   *slog.Logger
}

// MountPrintSession —— mount at /print-session/{token} under the
// /internal prefix the parent router has already applied.
func MountPrintSession(r chi.Router, deps PrintSessionDeps) {
	r.Get("/print-session/{token}", printSessionHandler(deps))
}

func printSessionHandler(deps PrintSessionDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")
		payload, err := deps.Store.Take(r.Context(), token)
		if err != nil {
			writePrintSessionErr(deps.Log, w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(payload); eerr != nil {
			deps.Log.Error("encode print session", "err", eerr)
		}
	}
}

func writePrintSessionErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, printsess.ErrSessionMiss) {
		http.Error(w, "print session not found", http.StatusNotFound)
		return
	}
	log.Error("print session take", "err", err)
	http.Error(w, "internal", http.StatusInternalServerError)
}
