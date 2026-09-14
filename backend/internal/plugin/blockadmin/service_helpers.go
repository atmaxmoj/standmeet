// service_helpers.go —— small standalone predicates + message helpers for the supplier admin
// service, split out of service.go to keep that file within the per-file line budget.

package blockadmin

import (
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// specLessKind — kinds that legitimately carry no openapi spec: a protocol supplier (smtp), a
// credential-only supplier (a token holder, e.g. telegram), and a block supplier (a seam served by
// an MCP block, e.g. the CalDAV block). They declare their seam directly and connect without an
// OAuth dance (a block connects via its Verify tool); only openapi parses a spec.
func specLessKind(kind string) bool {
	return kind == "protocol" || kind == "credential" || kind == "block"
}

// verifyReason — a human next step for a failed connection test (falls back to a plain sentence).
func verifyReason(err error) string {
	if r := adapters.FriendlyVerifyError(err); r != "" {
		return r
	}
	return "the connection test failed — check the host, port, and credentials"
}

// hasActive — whether any of the owner's connections for a seam is the active one.
func hasActive(conns []credentials.Connection) bool {
	for i := range conns {
		if conns[i].Active {
			return true
		}
	}
	return false
}
