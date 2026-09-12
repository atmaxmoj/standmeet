// service_deps.go — Service's injected dependency interfaces (satisfied by the
// composition root). Split out of service.go to keep the latter's public-struct count
// within budget.

package blockadmin

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
)

// ConnectionVerifier — the connection test run when a protocol supplier connects
// (the composition root wires this to Suppliers).
type ConnectionVerifier interface {
	VerifySupplier(ctx context.Context, blockID, ownerID string) error
}

// Installer — validate (assemble) an uploaded manifest + register it into the live
// supplier table, returning the seam it declares. The composition root wires this to
// AssembleOpenAPI + Suppliers.Register.
type Installer interface {
	Install(m *adapters.Manifest) (seam string, err error)
}

// OwnerLookup — this package only needs the owner's public_url to build the oauth
// redirect URI. Narrowed to reading just this one string, so it doesn't
// reverse-depend on the owner module; the composition root injects the implementation
// (owner.Repo satisfies this structurally).
type OwnerLookup interface {
	PublicURL(ctx context.Context, ownerID string) (string, error)
}
