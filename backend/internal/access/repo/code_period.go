// code_period.go —— evaluates the per-code, per-period rate gate (embed plan 2026-09-01).
//
// Relation to gas: gas is a **total pool** (spent down, refilled manually); this is a
// bucket that **auto-refills every period**. There's no counter column — how much is
// left is derived at read time by summing dialogs (the same approach as the gas / turn
// quota: no second piece of state means no "counter drifted from the fact" bug). The
// window is **rolling**: it counts this code's volume over the past period_seconds.

package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// turnsSince —— how many turns this code has accumulated since some moment
// (across all of this code's sessions). One dialog = one turn.
func (r *CodeRepo) turnsSince(ctx context.Context, codeID string, since time.Time) (int64, error) {
	cid, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return 0, fmt.Errorf("parse code id: %w", err)
	}
	n, qerr := db.New(r.pool).CountCodeTurnsSince(ctx, db.CountCodeTurnsSinceParams{
		CodeID:    cid,
		CreatedAt: pgtype.Timestamptz{Time: since, Valid: true},
	})
	if qerr != nil {
		return 0, fmt.Errorf("count code turns: %w", qerr)
	}
	return n, nil
}

// PeriodLimitExceeded —— whether this code has used up its quota for this period.
//
//   - Code has no period gate attached (limit_per_period IS NULL) → false, without
//     issuing a single query (same fast path as today).
//   - A turns gate is attached → count the turns in the past period_seconds; >= amount
//     is true (should deny).
//   - unit=='gas' isn't judged here yet (gas runs through the provider gas table, to be
//     wired in later); an unrecognized unit is treated as unlimited.
//
// The final turn can overshoot slightly: the gate is checked before the write, but usage
// lands only after the answer completes. Same trade-off as the gas / turn quota.
func (r *CodeRepo) PeriodLimitExceeded(ctx context.Context, codeID string) (bool, error) {
	code, err := r.GetByID(ctx, codeID)
	if err != nil {
		return false, err
	}
	w := code.LimitPerPeriod.TurnsCap()
	if w == nil {
		return false, nil
	}
	since := time.Now().Add(-time.Duration(w.PeriodSeconds) * time.Second)
	used, cerr := r.turnsSince(ctx, codeID, since)
	if cerr != nil {
		return false, cerr
	}
	return used >= w.Amount, nil
}

// CheckPeriodLimit —— used by the turn preflight; returns an error that can go straight
// to handleVisitorErr. An empty codeID (public/byoai session) → nil. Quota used up →
// ErrPeriodLimitReached (the caller translates it to a 403). The logic lives in the repo:
// the route layer has a cyclomatic-complexity cap of 3, so this decides "should this be
// blocked" on its behalf.
func (r *CodeRepo) CheckPeriodLimit(ctx context.Context, codeID string) error {
	if codeID == "" {
		return nil
	}
	over, err := r.PeriodLimitExceeded(ctx, codeID)
	if err != nil {
		return err
	}
	if over {
		return entity.ErrPeriodLimitReached
	}
	return nil
}
