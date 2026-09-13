// supplier_dispatch.go —— the door constructs the outbound-supplier dispatch subsystem.
//
// A supplier is "a block whose Provides is non-empty" (everything-is-a-block.md). Its dispatch
// holder (the Suppliers table + the Dispatcher over it) used to be allocated in the composition
// root (blockwire's EnsureBlockDispatch called adapters.NewSuppliers / NewDispatcher directly) —
// the reified supplier layer wired outside the door, the forbidden second path. Now the door owns
// that construction, the same shape as RegisterOwnerFibers / RegisterSeamProviders: the composition
// root ASSEMBLES the concrete suppliers (credential deps, egress — root work) and populates the
// table; the door OWNS the holder's lifecycle. One reference chain, facade→core (rule 2).
//
// The dispatch subsystem stays substrate (Go belongs in the substrate); what moved behind the door
// is who allocates and wires it.

package blockload

import (
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
)

// NewSupplierDispatch —— allocate the outbound-supplier table + the dispatcher over it, wired.
// The caller populates the table (Put) with the suppliers it assembled and registers their seams
// through RegisterSeamProviders.
func NewSupplierDispatch(
	store adapters.SeamStore, log *slog.Logger,
) (*adapters.Suppliers, *adapters.Dispatcher) {
	sups := adapters.NewSuppliers(store)
	disp := adapters.NewDispatcher(sups.Lookup)
	disp.SetSupplierByID(sups.ByID)
	disp.SetLogger(log)
	return sups, disp
}
