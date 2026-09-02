// facade_ops.go -- what this domain can do for outside callers, re-exported for convergence.
//
// Still just a facade: aliases only. Declared in internal/marketplace/ops.

package marketplace

import "github.com/atmaxmoj/standmeet/internal/marketplace/ops"

// Operation groups (implemented by: ops).
var (
	MCPServerOps   = ops.MCPServers
	SkillOps       = ops.Skills
	MarketplaceOps = ops.Marketplace
)
