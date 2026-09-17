// service_helpers.go —— small standalone predicates + message helpers for the supplier admin
// service, split out of service.go to keep that file within the per-file line budget.

package blockadmin

import (
	"errors"

	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// specLessKind — kinds that legitimately carry no openapi spec: a credential-only supplier (a token
// holder, e.g. telegram) and a block supplier (a seam served by an MCP block, e.g. the CalDAV or
// SMTP block). They declare their seam directly and connect with no OAuth dance (a block connects
// via its Verify tool); only openapi parses a spec.
func specLessKind(kind string) bool {
	return kind == "credential" || kind == "block"
}

// verifyReason — a human next step for a failed connection test (falls back to a plain sentence).
//
// A block-backed supplier OWNS its error classification: the block's `verify` tool returns a
// friendly, classified sentence (the SMTP block's auth/tls/connect wording), which crosses the
// boundary as a fault carrying that sentence. Surface it verbatim — the host stays blind to the
// classification, and the owner still sees "TLS handshake failed…" rather than a generic sentence.
// A fault is recognized by method, not type (fault.go), so blockadmin needn't import hostop.
func verifyReason(err error) string {
	var fc interface{ FaultCode() string }
	if errors.As(err, &fc) {
		if msg := err.Error(); msg != "" {
			return msg
		}
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
