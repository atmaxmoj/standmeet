// facade_ops.go —— what this domain can do externally, re-exported for the convergence point.
//
// Still just a facade: aliases only. Declared in internal/security/ops.

package security

import "github.com/atmaxmoj/standmeet/internal/security/ops"

// IPBanDeps —— what the ip_bans group needs (impl: ops).
type IPBanDeps = ops.IPBanDeps

// Operation groups (impl: ops).
var (
	IPBanOps   = ops.IPBans
	EventTypes = ops.EventTypes
)
