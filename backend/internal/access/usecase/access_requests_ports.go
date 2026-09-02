// access_requests_ports.go — narrow port for binding a visitor message to the sole
// owner; needs only ownerID.

package usecase

import "context"

// SoleOwnerLookup — fetches the owner id for a single-owner instance (used to bind
// an access request). The composition root adapts this via owner.Repo
// (FirstHandle→GetByHandle→ID); access does not reverse-depend on owner.
type SoleOwnerLookup interface {
	SoleOwnerID(ctx context.Context) (string, error)
}
