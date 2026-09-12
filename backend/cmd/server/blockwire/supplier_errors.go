// supplier_errors.go —— supplier domain errors → the converged facade's classified errors.
//
// `blockadmin/svc_errors.go` splits failures into the kinds a **caller needs
// to distinguish** (bad manifest / built-in can't be edited / can't connect / no
// client_id configured) — keeping them apart is what stops them collapsing into one
// vague error. That distinction used to be translated to HTTP by a hand-written admin
// route; once the operation moved into the converged facade, nothing translated it any
// more — so **every kind landed as a 500**. An owner deletes a built-in supplier, the
// product tells them "server error", and the truth is "this one can't be deleted".
//
// So the translation moved along with the operation: the domain declares its own op,
// and also declares what its own failures look like. The converged facade and each
// surface still only recognize fp's own classes — they don't need to know the
// concept "supplier" exists.

package blockwire

import (
	"errors"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockadmin"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// supplierErr —— translates a supplier sentinel into a class the converged facade
// recognizes. Anything unrecognized is a real fault (500).
//
// what is only used on the real-fault branch: an error that's already classified
// carries a message written for the owner, and shouldn't get wrapped in an internal
// action name like "delete supplier: " on top of that.
func supplierErr(what string, err error) error {
	// ErrInvalidManifest gets its own branch: it needs to carry the **specific
	// reason** (bad JSONata / unknown op / unknown seam / reaches into the
	// internal network) so the owner knows what to fix — a generic "invalid spec"
	// says nothing.
	if errors.Is(err, blockadmin.ErrInvalidManifest) {
		return fp.Coded(fp.BadInput(err.Error()), "invalid_manifest")
	}
	for i := range supplierCases {
		if errors.Is(err, supplierCases[i].sentinel) {
			return supplierCases[i].as
		}
	}
	return fp.OpErr(what, err)
}

// The outward-facing wording. All plain language written for the owner to read —
// never an internal action name, never the sentinel's raw text.
const (
	msgBuiltinReadonly = "this supplier is built-in and cannot be edited or deleted"
	msgConnectFailed   = "connection test failed — check host/port/credentials"
	msgNoCreds         = "supplier credentials not set"
	msgNoConnection    = "fill in this supplier's credentials first"
	msgStaleOAuth      = "this authorization link is expired or already used — start again"
)

// supplierCases —— sentinel → outward-facing wording. Table-driven: adding one more
// supplier error type only adds one row.
var supplierCases = []struct {
	sentinel error
	as       error
}{
	{blockadmin.ErrNotFound, fp.NotFound("no such supplier")},
	{blockadmin.ErrBuiltinReadonly, fp.Coded(fp.Conflict(msgBuiltinReadonly), "builtin_readonly")},
	{blockadmin.ErrConnectionFailed, fp.BadInput(msgConnectFailed)},
	{blockadmin.ErrNoOAuthClient, fp.BadInput(msgNoCreds)},
	{credentials.ErrNoConnection, fp.BadInput(msgNoConnection)},
	{blockadmin.ErrInvalidOAuthState, fp.BadInput(msgStaleOAuth)},
}
