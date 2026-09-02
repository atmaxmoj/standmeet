// visitor_gas_quota.go —— checks gas level once before a turn is sent (#7).
//
// Same shape as the neighboring visitor_turn_quota.go, just a different unit: turn count
// swapped for tokens.
//
//   · No metering attached → returns having sent **zero queries**. This isn't an
//     optimization, it's a structural requirement: the path most owners take (never
//     metering at all) must stay bit-for-bit identical to today — whether metering is
//     attached is decided by role, and it defaults to false.
//   · Metering attached → queries once before the write; if empty, returns a sentinel
//     the face translates into 403 + a human-readable sentence.
//   · Remaining amount isn't stored as a counter: the owner domain derives it by summing
//     usage on read (see provider_gas.go over there).
//
// The last turn can overshoot slightly: the gate runs before the write, usage is known
// only after the answer completes. Same tradeoff as the turn quota —— staying under a
// token exactly would require knowing the cost before answering, which is impossible.

package usecase

import (
	"context"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// GasQuotaInput —— this session's gas gauge parameters, frozen at session issue (along
// with the provider).
type GasQuotaInput struct {
	OwnerID    string
	ProviderID string
	// Metered —— whether this session has metering attached (the role's switch,
	// frozen into the session).
	Metered bool
}

// EnforceGasQuota —— returns nil = OK to send; access.ErrGasExhausted = the tank is
// empty.
func EnforceGasQuota(
	ctx context.Context, deps *VisitorSessionDeps, in *GasQuotaInput,
) error {
	if !gaugeIsOn(deps, in) {
		return nil
	}
	left, err := deps.Gas.Remaining(ctx, in.OwnerID, in.ProviderID)
	if err != nil {
		return fmt.Errorf("read gas: %w", err)
	}
	// nil = this tank has no metering attached. The role's switch is on but the tank
	// has never been filled, and together that still means "not metered": both
	// switches must be on, missing either one falls back to today's path.
	if left == nil || *left > 0 {
		return nil
	}
	return access.ErrGasExhausted
}

// gaugeIsOn —— whether this session needs to check gas level. All three must hold,
// otherwise zero queries are sent.
func gaugeIsOn(deps *VisitorSessionDeps, in *GasQuotaInput) bool {
	return in.Metered && in.ProviderID != "" && deps.Gas != nil
}
