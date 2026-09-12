// block_conn_errors.go — the centralized mapping from blockadmin sentinel errors to HTTP
// envelopes. Split out so block_conn.go stays under max-lines, and also so "how errors
// face outward" lives in one place: adding a new error touches only this file, handlers
// stay untouched.

package admin

import (
	"errors"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockadmin"
)

// connErrCases — sentinel → envelope (table-driven, dispatched by apierr.Classify; no
// match → 500).
var connErrCases = []apierr.Case{
	{Match: blockadmin.ErrNotFound, Envelope: apierr.Envelope{
		Status: http.StatusNotFound, Code: "not_found", Message: "not found",
	}},
	{Match: blockadmin.ErrNoOAuthClient, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "supplier credentials not set",
	}},
	{Match: blockadmin.ErrNoConnection, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "fill in this supplier's credentials first",
	}},
	{Match: blockadmin.ErrConnectionFailed, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "connection test failed — check host/port/credentials",
	}},
	{Match: blockadmin.ErrBuiltinReadonly, Envelope: apierr.Envelope{
		Status:  http.StatusConflict,
		Code:    "builtin_readonly",
		Message: "this supplier is built-in and cannot be edited or deleted",
	}},
	// ErrInvalidManifest isn't in the table: writeConnErr special-cases it and returns
	// err.Error() (carrying the specific assembly-failure reason, so the owner knows what
	// to fix), which is more useful than the table's generic message.
}

// writeConnErr translates a blockadmin sentinel into an HTTP envelope (dispatch is
// centralized here, keeping handlers at cyclo ≤3). An assembly failure carries the
// underlying reason (bad JSONata / unknown op / unknown seam / incomplete), so the
// owner knows what to fix.
func (h *Handlers) writeConnErr(w http.ResponseWriter, err error) {
	if errors.Is(err, blockadmin.ErrInvalidManifest) {
		writeError(h.Log, w, apierr.Envelope{
			Status: http.StatusBadRequest, Code: "invalid_manifest", Message: err.Error(),
		})
		return
	}
	env := apierr.Classify(err, connErrCases)
	if env.Status >= http.StatusInternalServerError {
		h.Log.Error("block connection admin", logErrKey, err)
	}
	writeError(h.Log, w, env)
}
