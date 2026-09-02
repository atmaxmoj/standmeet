// dep_registry.go —— category dependency registry: at boot, assembles built-in
// connectors into the Hub, and gives "is this category connected" a place to ask.
// The capabilities side uses it to decide whether a capability that declares
// Requires gets exposed.

package axisconn

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// DepRegistry —— the registry of named connector dependency providers. #155: at
// boot, discovery assembles built-in connectors into the Hub; the category dep is
// vouched for by the slot dispatcher (only lets it through once the active connector
// is connected). The provider only exposes "is this owner connected or not" —
// credentials stay inside the connector layer the whole time (a handle, not a
// credential).
func DepRegistry(ctx context.Context, d *deps.Runtime) *capreg.DepRegistry {
	depReg := capreg.NewDepRegistry()
	if err := RegisterDiscoveredConnectors(ctx, d, depReg); err != nil {
		d.Log.Error("register discovered connectors", "err", err)
	}
	return depReg
}
