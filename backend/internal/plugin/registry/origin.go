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
	// OriginMarketplace — installed from the dsh block marketplace (npm-backed). A
	// first-class block on the instance, sandboxed like any other, removable. A foreign
	// dsh block fetched from the market carries this origin too (reciprocity): marked
	// non-builtin so the panel does not present it as builtin, with no more trust.
	OriginMarketplace Origin = "marketplace"
)

// Deletable — the runtime-installed origins can be removed; the ones that only
// exist by virtue of the image (builtin) or a live connection (managed) cannot (P.6).
func (o Origin) Deletable() bool {
	switch o {
	case OriginOwner, OriginMarketplace:
		return true
	case OriginBuiltin, OriginManaged:
		// exist only via the image or a live connection — nothing to remove
		return false
	}
	return false
}
