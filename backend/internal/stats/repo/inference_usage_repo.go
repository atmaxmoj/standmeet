// inference_usage.go — #106 billing: access to the inference_usage table. Record writes
// one row per owner-key LLM call; admin Summary pulls the last-7-days day×model aggregate;
// Cleanup at boot deletes rows older than 7 days.

package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/stats/db"
	"github.com/atmaxmoj/standmeet/internal/stats/entity"
)

// InferenceUsageRepo — entry point for the inference_usage table.
type InferenceUsageRepo struct {
	pool *pgstore.Pool
}

// NewInferenceUsageRepo — DI constructor.
func NewInferenceUsageRepo(pool *pgstore.Pool) *InferenceUsageRepo {
	return &InferenceUsageRepo{pool: pool}
}

// UsageRow — usage for one owner-key LLM call. ProviderID empty = couldn't attribute it
// to a provider (a stale session / one that's been deleted); Metered = this call counts
// against that "tank of gas" (#7).
type UsageRow struct {
	OwnerID      string
	Model        string
	ProviderID   string
	InputTokens  int
	OutputTokens int
	CachedTokens int
	Metered      bool
}

// Record — records usage for one owner-key LLM call.
func (r *InferenceUsageRepo) Record(ctx context.Context, in *UsageRow) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	qerr := db.New(r.pool).RecordInferenceUsage(ctx, db.RecordInferenceUsageParams{
		OwnerID:      ownerUUID,
		Model:        in.Model,
		InputTokens:  int32(in.InputTokens),
		OutputTokens: int32(in.OutputTokens),
		CachedTokens: int32(in.CachedTokens),
		ProviderID:   pgstore.UUIDOrNull(in.ProviderID),
		Metered:      in.Metered,
	})
	if qerr != nil {
		return fmt.Errorf("record inference usage: %w", qerr)
	}
	return nil
}

// SpentSince — metered tokens a provider has spent since a given time. **No counter
// column**: summed on read, same as the turn quota, so "refueling" just moves the
// start point — nothing needs to be zeroed.
func (r *InferenceUsageRepo) SpentSince(
	ctx context.Context, providerID string, since time.Time,
) (int64, error) {
	providerUUID, err := pgstore.ParseUUID(providerID)
	if err != nil {
		return 0, fmt.Errorf("parse provider id: %w", err)
	}
	sum, qerr := db.New(r.pool).SumMeteredUsageSince(ctx, db.SumMeteredUsageSinceParams{
		ProviderID: providerUUID,
		CreatedAt:  pgtype.Timestamptz{Time: since, Valid: true},
	})
	if qerr != nil {
		return 0, fmt.Errorf("sum metered usage: %w", qerr)
	}
	return sum, nil
}

// Summarize7Day — an owner's last-7-days day×model aggregate.
func (r *InferenceUsageRepo) Summarize7Day(
	ctx context.Context, ownerID string,
) ([]entity.InferenceUsageDay, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).SummarizeInferenceUsage7Day(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("summarize inference usage: %w", qerr)
	}
	out := make([]entity.InferenceUsageDay, 0, len(rows))
	for i := range rows {
		out = append(out, entity.InferenceUsageDay{
			Day:          rows[i].Day.Time,
			Model:        rows[i].Model,
			Calls:        rows[i].Calls,
			InputTokens:  rows[i].InputTokens,
			OutputTokens: rows[i].OutputTokens,
		})
	}
	return out, nil
}

// Cleanup — deletes rows older than 7 days (called at boot; the query already only looks
// at 7 days, cleanup just keeps the table from growing without bound).
func (r *InferenceUsageRepo) Cleanup(ctx context.Context) error {
	if err := db.New(r.pool).DeleteInferenceUsageOlderThan7Days(ctx); err != nil {
		return fmt.Errorf("cleanup inference usage: %w", err)
	}
	return nil
}
