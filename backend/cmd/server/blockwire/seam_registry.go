// seam_registry.go —— seam dependency registry: at boot, assembles built-in
// suppliers into the supplier table, and gives "is this seam supplied" a place to ask.
// The block side uses it to decide whether a block that declares Requires gets exposed.

package blockwire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
	"github.com/atmaxmoj/standmeet/internal/routes/blockload"
)

// DepRegistry —— the registry of named seam dependency providers. #155: at
// boot, discovery assembles built-in suppliers into the table; the seam dep is
// vouched for by the dispatcher (only lets it through once the active supplier
// is connected). The provider only exposes "is this owner connected or not" —
// credentials stay inside the supplier layer the whole time (a handle, not a
// credential).
// **A shipped supplier that will not assemble is fatal**, the same way a face that does
// not match the dispatcher is (`assertDispatcherConformance`). The error this returns can
// only come from `supplierManifests()` — the blocks baked into the image, ours — because
// the owner's own uploads go through `registerUploadedSuppliers`, which logs and carries
// on so one bad paste cannot brick the instance.
//
// It used to log and continue, and that is how `google-calendar`'s binding sat broken: the
// manifest field was renamed `category` → `seam`, the data file kept saying `category`, the
// seam parsed as "", one ERROR line went by, and the instance came up **healthy with no
// calendar**. Booking would have been dead in prod and the only evidence was a log line
// nobody was reading. A shipped block failing to assemble is our bug, and it should stop
// the process while someone is still looking at it.
func DepRegistry(ctx context.Context, d *deps.Runtime) *registry.DepRegistry {
	depReg := registry.NewDepRegistry()
	// Assemble the providers in the composition root (construction: built-in suppliers into the
	// table + their seam shapes), then hand them to the ONE door to register — no second path
	// into the core registry (everything-is-a-block.md rule 2).
	supplierProviders, err := DiscoverSeamProviders(ctx, d)
	if err != nil {
		panic("blockwire: a built-in supplier does not assemble — " + err.Error())
	}
	all := append(baseSeamProviders(), supplierProviders...)
	blockload.RegisterSeamProviders(depReg, all)
	return depReg
}

// baseSeamProviders —— the seams the host itself supplies, not an owner-connected
// external supplier. `db` is the instance's own Postgres: a block that must persist
// declares `requires: [db]` (everything-is-a-block.md rule 3 — the db block is an
// ordinary block a stateful block depends on). Unlike calendar / smtp, db has nothing to
// connect: it is always available, so its provider reports connected unconditionally.
// This makes `requires: [db]` a first-class, gate-valid declaration (so boot validation
// accepts it and a db-requiring block is never seam-hidden); storage delivery itself stays
// with the bound blockstore.
func baseSeamProviders() []registry.DepProvider {
	return []registry.DepProvider{
		registry.NamedProvider("db",
			func(_ context.Context, _ string) (bool, error) { return true, nil }),
	}
}
