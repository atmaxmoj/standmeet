// connectors_errors.go — the centralized mapping from connectorsvc sentinel errors to
// HTTP envelopes. Split out so connectors.go stays under max-lines, and also so "how
// errors face outward" lives in one place: adding a new connector error touches only
// this file, handlers stay untouched.

package admin

import (
	"errors"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// connErrCases — sentinel → envelope (table-driven, dispatched by apierr.Classify; no
// match → 500).
var connErrCases = []apierr.Case{
	{Match: connector.ErrNotFound, Envelope: apierr.Envelope{
		Status: http.StatusNotFound, Code: "not_found", Message: "not found",
	}},
	{Match: connector.ErrNoOAuthClient, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "connector credentials not set",
	}},
	{Match: connector.ErrNoConnection, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "fill in this connector's credentials first",
	}},
	{Match: connector.ErrConnectionFailed, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "connection test failed — check host/port/credentials",
	}},
	{Match: connector.ErrBuiltinReadonly, Envelope: apierr.Envelope{
		Status:  http.StatusConflict,
		Code:    "builtin_readonly",
		Message: "this connector is built-in and cannot be edited or deleted",
	}},
	// ErrInvalidManifest isn't in the table: writeConnErr special-cases it and returns
	// err.Error() (carrying the specific assembly-failure reason, so the owner knows what
	// to fix), which is more useful than the table's generic message.
}

// writeConnErr translates a connectorsvc sentinel into an HTTP envelope (dispatch is
// centralized here, keeping handlers at cyclo ≤3). An assembly failure carries the
// underlying reason (bad JSONata / unknown op / unknown category / incomplete), so the
// owner knows what to fix.
func (h *Handlers) writeConnErr(w http.ResponseWriter, err error) {
	if errors.Is(err, connector.ErrInvalidManifest) {
		writeError(h.Log, w, apierr.Envelope{
			Status: http.StatusBadRequest, Code: "invalid_manifest", Message: err.Error(),
		})
		return
	}
	env := apierr.Classify(err, connErrCases)
	if env.Status >= http.StatusInternalServerError {
		h.Log.Error("connector admin", logErrKey, err)
	}
	writeError(h.Log, w, env)
}
