// helpers.go — small utilities shared by admin handlers: the generic 500 envelope + JSON
// output. Used to live in tokens.go / calendar_connector.go (both deleted); moved out
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

// writeJSON — 200 + JSON body.
//
//nolint:forbidigo // json.Encoder.Encode requires interface{}; allowed here, centrally
func writeJSON(log *slog.Logger, w http.ResponseWriter, v any) {
	writeJSONStatus(log, w, http.StatusOK, v)
}

//nolint:forbidigo // json.Encoder.Encode requires interface{}; allowed here, centrally
func writeJSONStatus(log *slog.Logger, w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Error("encode json", logErrKey, err)
	}
}
