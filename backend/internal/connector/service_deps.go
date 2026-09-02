// service_deps.go — Service's injected dependency interfaces (satisfied by the
// composition root). Split out of service.go to keep the latter's public-struct count
// within budget.

package connector

import (
	"context"
)

// ConnectionVerifier — the connection test run when a protocol connector connects
// (the composition root wires this to Slots).
type ConnectionVerifier interface {
	VerifyConnector(ctx context.Context, connectorID, ownerID string) error
}

// Installer — validate (assemble) an uploaded manifest + register it into the live
// Hub, returning the category it declares. The composition root wires this to
// AssembleOpenAPI + Slots.Register.
type Installer interface {
	Install(m *Manifest) (category string, err error)
}

// OwnerLookup — connector only needs the owner's public_url to build the oauth
// redirect URI. Narrowed to reading just this one string, so connector doesn't
// reverse-depend on the owner module; the composition root injects the implementation
// (owner.Repo satisfies this structurally).
type OwnerLookup interface {
	PublicURL(ctx context.Context, ownerID string) (string, error)
}
