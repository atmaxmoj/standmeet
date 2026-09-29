// helpers.go — small utilities shared by admin handlers: the generic 500 envelope + JSON
// output. Used to live in tokens.go / calendar_supplier.go (both deleted); moved out
// into its own file.

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

const logErrKey = "err"

func serverErr() apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}

// jsonBody —— the bodies the hand-written admin routes answer with (the dispatched ones write the
// convergence point's JSON verbatim). A new body type joins the set, so what a route sends stays
// a named shape instead of `any`.
type jsonBody interface {
	recoverResponse | confirmEmailResponse | []sessionView | credFormResp | connectInitResp |
		vaultStateView | genreTagsResponse | []subjectivityListItem | apierr.Envelope |
		map[string]bool | map[string]int64
}

// writeJSON — 200 + JSON body.
func writeJSON[T jsonBody](log *slog.Logger, w http.ResponseWriter, v T) {
	writeJSONStatus(log, w, http.StatusOK, v)
}

func writeJSONStatus[T jsonBody](log *slog.Logger, w http.ResponseWriter, status int, v T) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Error("encode json", logErrKey, err)
	}
}
