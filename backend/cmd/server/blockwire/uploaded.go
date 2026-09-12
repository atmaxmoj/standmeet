// uploaded.go —— at boot, assembles owner-built (uploaded) suppliers from the DB
// back into the supplier table. Split out of supplier_register.go to keep it under the
// max-lines guard; the fault-isolation boundary logic (a bad supplier is skipped, not
// letting it take down boot) lives here on its own.

package blockwire

import (
	"context"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// registerUploadedSuppliers —— reassembles the owner-built suppliers from the DB
// at boot (through the same assembleSupplier path as the built-ins).
// **Fault isolation**: never aborts boot — a supplier that can't be assembled is
// only skipped + logged, and never takes down the others, let alone the instance.
func registerUploadedSuppliers(
	ctx context.Context, sups *adapters.Suppliers, repo *credentials.Repo,
	deps *assembleDeps, log *slog.Logger,
) {
	uploaded, err := repo.ListUploaded(ctx)
	if err != nil {
		// skip uploads, built-ins proceed as normal
		log.Error("load uploaded suppliers", "err", err)
		return
	}
	for i := range uploaded {
		u := &uploaded[i]
		if _, isBuiltin := sups.ByID(u.BlockID); isBuiltin {
			// a built-in's "connection row" (owner connected built-in smtp/gcal):
			// not an uploaded definition, already assembled
			continue
		}
		m := &adapters.Manifest{
			ID: u.BlockID, Kind: u.Kind, Seam: u.Seam, Protocol: u.Protocol,
			AuthScheme: u.AuthScheme, Spec: u.Spec, Binding: u.Binding,
			ExposeAsAgentTools: u.ExposeAsAgentTools,
		}
		c, aerr := assembleSupplier(m, deps)
		if aerr != nil {
			log.Error("skip unassemblable uploaded supplier", "id", u.BlockID, "err", aerr)
			continue // skip this one bad supplier, don't abort
		}
		sups.Put(c)
	}
}
