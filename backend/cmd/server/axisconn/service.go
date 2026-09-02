// service.go —— construction of the connector orchestration service. The admin
// panel and the connectors resource share the same one.
//
// It used to sit in the assembly root's pile of "adapters", because ownercore
// couldn't import the connector service, so every method had to shuttle params and
// results between two equivalent type sets. Once connectors were declared by the
// connector axis itself, that translation layer disappeared entirely — the
// declaration and the implementation are on the same side, so there's no second type
// set. This construction moved back to the axis itself along with it.

package axisconn

import (
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/connector"
)

// NewService —— builds the connector orchestration service.
func NewService(d *deps.Runtime) *connector.Service {
	return connector.New(&connector.Deps{
		Repo: d.ConnectorRepo, Owners: d.OwnerRepo, Redis: d.RDB,
		HTTP: connectorEgressClient(), Verifier: d.ConnectorSlots,
		Installer: uploadedInstaller{
			slots: d.ConnectorSlots, deps: newAssembleDeps(d.ConnectorRepo),
		},
		Manifests: loadBuiltinConnectorManifests(d),
	})
}
