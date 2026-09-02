// provider_gas.go — how much fuel is left in the tank.
//
// **No counter column.** Remaining = how much was topped up - the metered usage
// recorded against this provider since the moment of that top-up. Same approach as the
// turn quota (there, "turn count is no longer stored, it's derived from messages on
// read"): no second piece of state, so there's no "counter disagrees with reality" bug
// class; topping up just moves the starting point forward, nothing needs to be zeroed.
//
// The usage table belongs to the stats domain, which this domain doesn't know about —
// so this only declares a narrow port (SpendReader), wired up by the composition root.
// There's exactly one place this arithmetic lives: the reading shown in the panel and
// the gate that blocks visitors go through the same function.

package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// SpendReader — the metered tokens a provider has spent since a given moment
// (implemented by the stats domain).
type SpendReader interface {
	SpentSince(ctx context.Context, providerID string, since time.Time) (int64, error)
}

// ProviderRemaining — how many tokens this provider has left. nil = this tank has no
// meter attached (unmetered).
//
// A negative number clamps to 0: the last round can go a little over (the gate checks
// before the write, usage is recorded after), and "-37 remaining" isn't a useful
// sentence to whoever reads it.
func ProviderRemaining(
	ctx context.Context, spend SpendReader, row *repo.ProviderRow,
) (*int64, error) {
	if row.GasTokens == nil || spend == nil {
		return nil, nil //nolint:nilnil // nil = unmetered, a normal answer in this domain
	}
	spent, err := spend.SpentSince(ctx, row.ID, gasPeriodStart(row))
	if err != nil {
		return nil, fmt.Errorf("read provider spend: %w", err)
	}
	left := max(*row.GasTokens-spent, 0)
	return &left, nil
}

// gasPeriodStart — the moment accounting starts from. An old row (topped up but never
// recorded a timestamp) falls back to the zero time: at that point the metering table
// had no rows yet anyway, so the sum comes out the same.
func gasPeriodStart(row *repo.ProviderRow) time.Time {
	if row.GasFilledAt == nil {
		return time.Time{}
	}
	return *row.GasFilledAt
}
