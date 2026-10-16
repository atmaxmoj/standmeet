// inference_usage.go — #106 billing: access to the inference_usage table. Record writes
// one row per owner-key LLM call; admin Summary pulls the last-7-days day×model aggregate;
// Cleanup at boot deletes rows older than 7 days.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
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
	OwnerID    string
	Model      string
	ProviderID string
	// Feature —— which feature spent it: 'chat:<role>' or 'block:<plugin>'.
	Feature      string
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
		Feature:      in.Feature,
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

// SummarizeByFeature7Day — an owner's last-7-days feature×model aggregate.
func (r *InferenceUsageRepo) SummarizeByFeature7Day(
	ctx context.Context, ownerID string,
) ([]entity.InferenceUsageFeature, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).SummarizeInferenceUsageByFeature7Day(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("summarize inference usage by feature: %w", qerr)
	}
	out := make([]entity.InferenceUsageFeature, 0, len(rows))
	for i := range rows {
		out = append(out, entity.InferenceUsageFeature{
			Feature: rows[i].Feature, Model: rows[i].Model, Calls: rows[i].Calls,
			InputTokens: rows[i].InputTokens, OutputTokens: rows[i].OutputTokens,
		})
	}
	return out, nil
}

// ModelMap — the owner's default provider and every role / code that names its own.
func (r *InferenceUsageRepo) ModelMap(
	ctx context.Context, ownerID string,
) (entity.ModelMap, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.ModelMap{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	var out entity.ModelMap
	if out.Default, err = defaultProvider(ctx, q, ownerUUID); err != nil {
		return out, err
	}
	if out.Roles, err = roleProviders(ctx, q, ownerUUID); err != nil {
		return out, err
	}
	out.Codes, err = codeProviders(ctx, q, ownerUUID)
	return out, err
}

// defaultProvider —— an owner with no default provider yet reads as an empty one.
func defaultProvider(
	ctx context.Context, q *db.Queries, owner pgtype.UUID,
) (entity.ProviderModel, error) {
	d, err := q.DefaultProviderModel(ctx, owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ProviderModel{}, nil
	}
	if err != nil {
		return entity.ProviderModel{}, fmt.Errorf("default provider: %w", err)
	}
	return entity.ProviderModel{Label: d.Label, Model: d.Model}, nil
}

func roleProviders(
	ctx context.Context, q *db.Queries, owner pgtype.UUID,
) ([]entity.RoleProvider, error) {
	roles, err := q.RoleProviderModels(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("role providers: %w", err)
	}
	out := make([]entity.RoleProvider, 0, len(roles))
	for i := range roles {
		out = append(out, entity.RoleProvider{
			Name: roles[i].Name, Codes: roles[i].Codes,
			Provider: entity.ProviderModel{
				Label: deref(roles[i].ProviderLabel), Model: deref(roles[i].ProviderModel),
			},
		})
	}
	return out, nil
}

func codeProviders(
	ctx context.Context, q *db.Queries, owner pgtype.UUID,
) ([]entity.CodeProvider, error) {
	codes, err := q.CodeProviderModels(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("code providers: %w", err)
	}
	out := make([]entity.CodeProvider, 0, len(codes))
	for i := range codes {
		out = append(out, entity.CodeProvider{
			Code: codes[i].Code,
			Provider: entity.ProviderModel{
				Label: codes[i].ProviderLabel, Model: codes[i].ProviderModel,
			},
		})
	}
	return out, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// Cleanup — deletes rows older than 7 days (called at boot; the query already only looks
// at 7 days, cleanup just keeps the table from growing without bound).
func (r *InferenceUsageRepo) Cleanup(ctx context.Context) error {
	if err := db.New(r.pool).DeleteInferenceUsageOlderThan7Days(ctx); err != nil {
		return fmt.Errorf("cleanup inference usage: %w", err)
	}
	return nil
}
