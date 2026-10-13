// microsite_retention.go —— a page's side of the ephemeral clock
// (docs/design/job-loop-retention.md):
// join a bundle, renew it, and tell an expired page from a missing one.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrNoSuchBundle —— no live bundle of the owner's has this id.
var ErrNoSuchBundle = errors.New("no such retention bundle (or it has been cleared)")

// TouchBundle —— renew the page's bundle; a forever page has none and nothing happens.
func (r *MicrositeRepo) TouchBundle(ctx context.Context, pageID string) error {
	if err := db.New(r.pool).TouchPageBundle(ctx, pgstore.UUIDOrNull(pageID)); err != nil {
		return fmt.Errorf("touch page bundle: %w", err)
	}
	return nil
}

// JoinBundle —— put the page on bundleID's clock (it must be the owner's and live), or on a new
// one when bundleID is empty. Returns the bundle.
func (r *MicrositeRepo) JoinBundle(
	ctx context.Context, ownerID, pageID, bundleID string,
) (string, error) {
	owner := pgstore.UUIDOrNull(ownerID)
	err := pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		q := db.New(tx)
		id, err := bundleOrNew(ctx, q, owner, bundleID)
		if err != nil {
			return err
		}
		bundleID = pgstore.FormatUUID(id)
		_, err = q.SetPageBundle(ctx, db.SetPageBundleParams{
			ID: pgstore.UUIDOrNull(pageID), OwnerID: owner, BundleID: id,
		})
		return err
	})
	if err != nil {
		return "", fmt.Errorf("join bundle: %w", err)
	}
	return bundleID, nil
}

func bundleOrNew(
	ctx context.Context, q *db.Queries, owner pgtype.UUID, bundleID string,
) (pgtype.UUID, error) {
	if bundleID == "" {
		return q.CreateRetentionBundle(ctx, owner)
	}
	id := pgstore.UUIDOrNull(bundleID)
	live, err := q.RetentionBundleLive(ctx, db.RetentionBundleLiveParams{ID: id, OwnerID: owner})
	if err == nil && !live {
		err = ErrNoSuchBundle
	}
	return id, err
}

// PageExpired —— the slug's page ran out of time (and was not restored or replaced since).
func (r *MicrositeRepo) PageExpired(ctx context.Context, ownerID, slug string) (bool, error) {
	ok, err := db.New(r.pool).PageExpired(ctx, db.PageExpiredParams{
		OwnerID: pgstore.UUIDOrNull(ownerID), Slug: slug,
	})
	if err != nil {
		return false, fmt.Errorf("page expired: %w", err)
	}
	return ok, nil
}
