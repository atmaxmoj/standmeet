package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
)

// RefillProvider —— a provider that has an auto-refill schedule set: just enough to decide whether
// its gas tank is due to re-open (id + schedule + when it was last filled).
type RefillProvider struct {
	GasFilledAt   time.Time
	ID            string
	OwnerID       string
	GasRefillCron string
}

// RefilledHook —— runs on the refill's transaction, so what it writes commits with the new fill
// mark.
type RefilledHook func(ctx context.Context, tx pgstore.Tx, p *RefillProvider) error

// ListRefillableProviders —— every provider with a non-empty gas_refill_cron.
func (r *Repo) ListRefillableProviders(ctx context.Context) ([]RefillProvider, error) {
	rows, err := db.New(r.pool).ListRefillableProviders(ctx)
	if err != nil {
		return nil, fmt.Errorf("list refillable providers: %w", err)
	}
	out := make([]RefillProvider, 0, len(rows))
	for i := range rows {
		var filled time.Time
		if t := pgstore.OptTime(rows[i].GasFilledAt); t != nil {
			filled = *t
		}
		out = append(out, RefillProvider{
			ID:            pgstore.FormatUUID(rows[i].ID),
			OwnerID:       pgstore.FormatUUID(rows[i].OwnerID),
			GasRefillCron: rows[i].GasRefillCron,
			GasFilledAt:   filled,
		})
	}
	return out, nil
}

// BumpGasFilledAt —— re-open a tank by moving its fill mark to now (restores the full budget, since
// remaining is derived as gas_tokens − spend-since-gas_filled_at; there is no counter to reset).
func (r *Repo) BumpGasFilledAt(ctx context.Context, id string) error {
	uid, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return fmt.Errorf("parse provider id: %w", perr)
	}
	if _, err := db.New(r.conn()).BumpProviderGasFilledAt(ctx, uid); err != nil {
		return fmt.Errorf("bump gas filled at: %w", err)
	}
	return nil
}

// MarkGasExhausted —— stamps the tank dry, once per fill: true only when the mark moved (it was
// unset, or older than the last fill). The caller records gas.exhausted on the same q.
func (r *Repo) MarkGasExhausted(ctx context.Context, ownerID, providerID string) (bool, error) {
	tag, err := r.conn().Exec(ctx, `UPDATE owner_providers SET gas_exhausted_at = now()
		WHERE id::text = $1 AND owner_id::text = $2 AND (gas_exhausted_at IS NULL
		OR gas_exhausted_at < coalesce(gas_filled_at, '-infinity'::timestamptz))`,
		providerID, ownerID)
	if err != nil {
		return false, fmt.Errorf("mark gas exhausted: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// gasRefillEvery ——how often the checker runs. It only needs to be fine enough that a refill lands
// soon after its cron boundary; the cron decides WHEN, this decides the lag. 5 min keeps the query
// load trivial.
const gasRefillEvery = 5 * time.Minute

// GasRefillPeriodicJobs —— re-open each provider's gas tank when its refill cron ticks. r == nil →
// no jobs (a dashboard shouldn't show a job that does nothing).
func GasRefillPeriodicJobs(r *Repo, refilled RefilledHook) []periodic.Job {
	if r == nil {
		return []periodic.Job{}
	}
	return []periodic.Job{periodic.Named(
		"gas refill", gasRefillEvery,
		func(ctx context.Context) error { return RunGasRefill(ctx, r, time.Now(), refilled) },
	)}
}

// RunGasRefill —— re-open every tank whose refill schedule has ticked since its last fill.
func RunGasRefill(ctx context.Context, r *Repo, now time.Time, refilled RefilledHook) error {
	provs, err := r.ListRefillableProviders(ctx)
	if err != nil {
		return err
	}
	for i := range provs {
		if rerr := refillOne(ctx, r, &provs[i], now, refilled); rerr != nil {
			return rerr
		}
	}
	return nil
}

// refillOne —— bump one tank's fill mark to now if its schedule is due; the bump and the hook's
// writes commit together.
func refillOne(
	ctx context.Context, r *Repo, p *RefillProvider, now time.Time, refilled RefilledHook,
) error {
	due, derr := periodic.CronDue(p.GasRefillCron, p.GasFilledAt, now)
	if derr != nil {
		// Shouldn't happen: a malformed schedule is rejected at write time (periodic.ValidCron).
		return fmt.Errorf("refill %s: %w", p.ID, derr)
	}
	if !due {
		return nil
	}
	//nolint:wrapcheck // the steps name themselves
	return pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		if err := r.With(tx).BumpGasFilledAt(ctx, p.ID); err != nil || refilled == nil {
			return err
		}
		return refilled(ctx, tx, p)
	})
}
