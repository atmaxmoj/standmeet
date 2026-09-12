// origin.go — Phase H / P.5: every registered block carries an Origin,
// which the admin surface groups by (OriginOf) + uses to decide deletability.
// Origin is set at Register time (default builtin); plugin-discovered
// blocks get managed, owner-authored ones get owner.

package registry

// Origin — where a block comes from. Determines the admin surface's
// badge + delete entry point (P.6: existence is controlled by Origin; only
// owner-origin can be deleted).
type Origin string

const (
	// OriginBuiltin — a built-in block shipped with the product
	// (corpus.retrieval / calendar.book …). Can be turned off but not deleted
	// (P.7).
	OriginBuiltin Origin = "builtin"
	// OriginManaged — a platform-managed supplier type (Google
	// Calendar / SMTP). Can be turned off but not deleted; deleting means
	// disconnecting, not removing the block.
	OriginManaged Origin = "managed"
	// OriginOwner — authored by the owner themselves (a skill / a registered
	// MCP server). Can be deleted.
	OriginOwner Origin = "owner"
)

// Deletable — only owner-origin can be deleted (P.6).
func (o Origin) Deletable() bool { return o == OriginOwner }
