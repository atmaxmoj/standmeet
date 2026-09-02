// uploaded.go —— at boot, assembles owner-built (uploaded) connectors from the DB
// back into the Hub. Split out of register.go to keep it under the max-lines guard;
// the fault-isolation boundary logic (a bad connector is skipped, not letting it
// take down boot) lives here on its own.

package axisconn

import (
	"context"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// registerUploadedConnectors —— reassembles the owner-built connectors from the DB
// at boot (through the same assembleConnector path as the built-ins).
// **Fault isolation**: never aborts boot — a connector that can't be assembled is
// only skipped + logged, and never takes down the others, let alone the instance.
func registerUploadedConnectors(
	ctx context.Context, hub *connector.Hub, repo *connector.Repo,
	deps *assembleDeps, log *slog.Logger,
) {
	uploaded, err := repo.ListUploaded(ctx)
	if err != nil {
		// skip uploads, built-ins proceed as normal
		log.Error("load uploaded connectors", "err", err)
		return
	}
	for i := range uploaded {
		u := &uploaded[i]
		if _, isBuiltin := hub.Resolve(u.ConnectorID); isBuiltin {
			// a built-in's "connection row" (owner connected built-in smtp/gcal):
			// not an uploaded definition, already assembled
			continue
		}
		m := &connector.Manifest{
			ID: u.ConnectorID, Kind: u.Kind, Category: u.Category, Protocol: u.Protocol,
			AuthScheme: u.AuthScheme, Spec: u.Spec, Binding: u.Binding,
			ExposeAsAgentTools: u.ExposeAsAgentTools,
		}
		c, aerr := assembleConnector(m, deps)
		if aerr != nil {
			log.Error("skip unassemblable uploaded connector", "id", u.ConnectorID, "err", aerr)
			continue // skip this one bad connector, don't abort
		}
		hub.Upsert(c)
	}
}
