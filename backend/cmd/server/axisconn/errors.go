// errors.go —— connector domain errors → the converged facade's classified errors.
//
// `internal/connector/svc_errors.go` splits failures into the kinds a **caller needs
// to distinguish** (bad manifest / built-in can't be edited / can't connect / no
// client_id configured) — keeping them apart is what stops them collapsing into one
// vague error. That distinction used to be translated to HTTP by the admin package's
// hand-written route (`writeConnErr` in `routes/admin/connectors_errors.go`); once the
// operation moved into the converged facade, nothing translated it any more — so
// **every kind landed as a 500**. An owner deletes a built-in connector, the product
// tells them "server error", and the truth is "this connector can't be deleted".
//
// So the translation moved along with the operation: the domain declares its own op,
// and also declares what its own failures look like. The converged facade and each
// surface still only recognize fp's own categories — they don't need to know the
// concept "connector" exists.

package axisconn

import (
	"errors"

	"github.com/atmaxmoj/standmeet/internal/connector"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// connErr —— translates a connector sentinel into a category the converged facade
// recognizes. Anything unrecognized is a real fault (500).
//
// what is only used on the real-fault branch: an error that's already classified
// carries a message written for the owner, and shouldn't get wrapped in an internal
// action name like "delete connector: " on top of that.
func connErr(what string, err error) error {
	// ErrInvalidManifest gets its own branch: it needs to carry the **specific
	// reason** (bad JSONata / unknown op / unknown category / reaches into the
	// internal network) so the owner knows what to fix — a generic "invalid spec"
	// says nothing.
	if errors.Is(err, connector.ErrInvalidManifest) {
		return fp.Coded(fp.BadInput(err.Error()), "invalid_manifest")
	}
	for i := range connCases {
		if errors.Is(err, connCases[i].sentinel) {
			return connCases[i].as
		}
	}
	return fp.OpErr(what, err)
}

// The outward-facing wording. All plain language written for the owner to read —
// never an internal action name, never the sentinel's raw text.
const (
	msgBuiltinReadonly = "this connector is built-in and cannot be edited or deleted"
	msgConnectFailed   = "connection test failed — check host/port/credentials"
	msgNoCreds         = "connector credentials not set"
	msgNoConnection    = "fill in this connector's credentials first"
	msgStaleOAuth      = "this authorization link is expired or already used — start again"
)

// connCases —— sentinel → outward-facing wording. Table-driven: adding one more
// connector error type only adds one row.
var connCases = []struct {
	sentinel error
	as       error
}{
	{connector.ErrNotFound, fp.NotFound("no such connector")},
	{connector.ErrBuiltinReadonly, fp.Coded(fp.Conflict(msgBuiltinReadonly), "builtin_readonly")},
	{connector.ErrConnectionFailed, fp.BadInput(msgConnectFailed)},
	{connector.ErrNoOAuthClient, fp.BadInput(msgNoCreds)},
	{connector.ErrNoConnection, fp.BadInput(msgNoConnection)},
	{connector.ErrInvalidOAuthState, fp.BadInput(msgStaleOAuth)},
}
