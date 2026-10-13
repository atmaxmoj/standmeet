// retention.go —— the one clock of ephemeral things (docs/design/job-loop-retention.md): a bundle
// row, the pages on it, and the steps the sweep and a restore take.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
)

// ErrRetentionSlugTaken —— a restored page's slug was taken by a newer page meanwhile.
var ErrRetentionSlugTaken = errors.New("a restored page's address is taken by a newer page")

// RetentionRepo —— retention_bundles plus the page side of a bundle.
type RetentionRepo struct{ pool *pgstore.Pool }

// NewRetentionRepo —— constructor.
func NewRetentionRepo(pool *pgstore.Pool) *RetentionRepo { return &RetentionRepo{pool: pool} }

// DueBundle —— a bundle whose clock ran out.
type DueBundle struct {
	ID      string
	OwnerID string
}

// Pin —— pin or unpin (a touch either way); false when no live bundle of the owner's has this id.
func (r *RetentionRepo) Pin(ctx context.Context, ownerID, id string, keep bool) (bool, error) {
	n, err := db.New(r.pool).PinRetentionBundle(ctx, db.PinRetentionBundleParams{
		ID: pgstore.UUIDOrNull(id), OwnerID: pgstore.UUIDOrNull(ownerID), Keep: keep,
	})
	if err != nil {
		return false, fmt.Errorf("pin retention bundle: %w", err)
	}
	return n > 0, nil
}

// Due —— unpinned, uncleared bundles last touched before the cutoff.
func (r *RetentionRepo) Due(ctx context.Context, before time.Time) ([]DueBundle, error) {
	rows, err := db.New(r.pool).DueRetentionBundles(ctx,
		pgtype.Timestamptz{Time: before, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("due retention bundles: %w", err)
	}
	out := make([]DueBundle, 0, len(rows))
	for _, row := range rows {
		out = append(out, DueBundle{
			ID: pgstore.FormatUUID(row.ID), OwnerID: pgstore.FormatUUID(row.OwnerID),
		})
	}
	return out, nil
}

// PageIDs —— the bundle's pages not yet in the trash.
func (r *RetentionRepo) PageIDs(ctx context.Context, bundleID string) ([]string, error) {
	ids, err := db.New(r.pool).BundlePageIDs(ctx, pgstore.UUIDOrNull(bundleID))
	if err != nil {
		return nil, fmt.Errorf("bundle pages: %w", err)
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, pgstore.FormatUUID(id))
	}
	return out, nil
}

// Expire —— in one transaction: the bundle's pages go to the trash marked expired, the bundle is
// cleared, and record runs (the audit event). False when the bundle was already cleared.
func (r *RetentionRepo) Expire(
	ctx context.Context, bundleID string, record func(pgstore.Tx) error,
) (bool, error) {
	cleared := false
	err := pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		q, id := db.New(tx), pgstore.UUIDOrNull(bundleID)
		n, err := q.ClearRetentionBundle(ctx, id)
		if err != nil || n == 0 {
			return err
		}
		if xerr := q.ExpireBundlePages(ctx, id); xerr != nil {
			return xerr
		}
		cleared = true
		return record(tx)
	})
	if err != nil {
		return false, fmt.Errorf("expire retention bundle: %w", err)
	}
	return cleared, nil
}

// Restore —— in one transaction: the bundle's clock restarts and its expired pages come back.
// False when no cleared bundle of the owner's has this id.
func (r *RetentionRepo) Restore(
	ctx context.Context, ownerID, bundleID string, record func(pgstore.Tx) error,
) (bool, error) {
	restored := false
	err := pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		q, id := db.New(tx), pgstore.UUIDOrNull(bundleID)
		n, err := q.RestoreRetentionBundle(ctx, db.RestoreRetentionBundleParams{
			ID: id, OwnerID: pgstore.UUIDOrNull(ownerID),
		})
		if err != nil || n == 0 {
			return err
		}
		if perr := q.RestoreBundlePages(ctx, id); perr != nil {
			return slugTakenOr(perr)
		}
		restored = true
		return record(tx)
	})
	if err != nil {
		return false, fmt.Errorf("restore retention bundle: %w", err)
	}
	return restored, nil
}

func slugTakenOr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrRetentionSlugTaken
	}
	return err
}
