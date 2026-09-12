// seam_registry.go —— seam dependency registry: at boot, assembles built-in
// suppliers into the supplier table, and gives "is this seam supplied" a place to ask.
// The block side uses it to decide whether a block that declares Requires gets exposed.

package blockwire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
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
	if err := RegisterDiscoveredSuppliers(ctx, d, depReg); err != nil {
		panic("blockwire: a built-in supplier does not assemble — " + err.Error())
	}
	return depReg
}
