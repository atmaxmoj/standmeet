// manifests.go — where the declarations for the built-in capabilities come from.
//
// **The declarations themselves don't live here** — they live in
// backend/capabilities/<id>/manifest.yaml, the same shape as backend/connectors/: two plugin
// axes, the same address structure. This file is just the assembly root's port for pulling them.
//
// This used to be five Go literals (a capability's identity, which host ops it calls, which
// field it occupies on a code, its config defaults), 200-plus lines. That was **a capability's
// own knowledge written into the assembly site** — the assembly root should only do assembly.

package axiscap

import (
	"github.com/atmaxmoj/standmeet/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// BuiltinManifests — the built-in capabilities' declarations, read in at one place.
// Registration, facade-parity reconciliation, inbound-convergence dispatch, code-side fields,
// and usage gates all read this same copy; nothing ever checks against a stale duplicate.
//
// Failing to read / parse it → **panic**. The built-in declarations are an asset shipped with
// the product, not a runtime condition: a broken manifest means this build is broken, and
// letting it come up with half a capability set would only push the problem onto visitors.
func BuiltinManifests() []mcpplugin.Manifest {
	return builtins
}

// builtins — read once per process.
var builtins = mustLoadBuiltins()

func mustLoadBuiltins() []mcpplugin.Manifest {
	out, err := capabilities.Load()
	if err != nil {
		panic(err)
	}
	return out
}
