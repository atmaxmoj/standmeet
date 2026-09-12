// service.go —— construction of the supplier orchestration service. The admin
// panel and the suppliers resource share the same one.
//
// It used to sit in the assembly root's pile of "adapters", because ownercore
// couldn't import the supplier service, so every method had to shuttle params and
// results between two equivalent type sets. Once suppliers were declared by their own
// manifests, that translation layer disappeared entirely — the declaration and the
// implementation are on the same side, so there's no second type set. This construction
// moved back here along with it.

package blockwire

import (
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockadmin"
)

// NewService —— builds the supplier orchestration service.
func NewService(d *deps.Runtime) *blockadmin.Service {
	return blockadmin.New(&blockadmin.Deps{
		Repo: d.Credentials, Owners: d.OwnerRepo, Redis: d.RDB,
		HTTP: supplierEgressClient(), Verifier: d.BlockSuppliers,
		Installer: uploadedInstaller{
			sups: d.BlockSuppliers, deps: newAssembleDeps(d.Credentials),
		},
		Manifests: loadBuiltinSupplierManifests(d),
	})
}
