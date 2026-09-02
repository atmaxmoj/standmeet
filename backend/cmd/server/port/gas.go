// gas.go — composition root wires "how much gas is left in the tank" into the
// visitor path (#7).
//
// The tank lives in the owner domain (owner_providers), usage lives in the stats
// domain (inference_usage), and the gate blocking visitors lives in the conversation
// domain. None of the three domains should import the other two, so that arithmetic
// stays in the owner domain (it owns the tank); conversation only declares a narrow
// "how much is left" port, and the composition root wires it up here.
//
// **The arithmetic exists in exactly one place**: the reading shown to the owner on
// the panel and the gate that blocks visitors run through the same function.

package port

import (
	"context"
	"fmt"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// OwnerGas — conversation.GasGauge implementation.
type OwnerGas struct {
	Providers owner.ProvidersUseDeps
}

// Remaining — how many tokens are left on this provider. nil = no meter attached
// (unmetered).
func (g OwnerGas) Remaining(
	ctx context.Context, ownerID, providerID string,
) (*int64, error) {
	left, err := owner.GasRemaining(ctx, g.Providers, ownerID, providerID)
	if err != nil {
		return nil, fmt.Errorf("provider gas: %w", err)
	}
	return left, nil
}

// DefaultProviderID — the id of the owner's default provider (empty string when no
// provider is configured). Used when issuing a visitor session to freeze "unspecified
// provider" into one concrete tank, otherwise anonymous spend is invisible to gas
// accounting (see the same-named function in owner/usecase). Shares the same
// Providers dependency as Remaining, so this adapter is reused.
func (g OwnerGas) DefaultProviderID(ctx context.Context, ownerID string) (string, error) {
	id, err := owner.DefaultProviderID(ctx, g.Providers, ownerID)
	if err != nil {
		return "", fmt.Errorf("default provider id: %w", err)
	}
	return id, nil
}
