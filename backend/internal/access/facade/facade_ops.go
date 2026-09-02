// facade_ops.go —— the actions this domain exposes outward, re-exported here for the
// convergence point.
//
// Still just a facade: aliases only. Declared in internal/access/ops.

package access

import "github.com/atmaxmoj/standmeet/internal/access/ops"

// Types (impl: ops).
type (
	CodeExtras = ops.CodeExtras
	RoleExtras = ops.RoleExtras
	// KeyExtras —— fields a capability occupies on an outward-facing API key (F-B-11).
	KeyExtras  = ops.KeyExtras
	OpsAPIKeys = ops.APIKeysDeps
	OpsCodes   = ops.CodesDeps
	OpsEmbeds  = ops.EmbedsDeps
	OpsRoles   = ops.RolesDeps
)

// Operation groups (impl: ops).
var (
	APIKeyOps = ops.APIKeys
	CodeOps   = ops.Codes
	EmbedOps  = ops.Embeds
	RoleOps   = ops.Roles
)
