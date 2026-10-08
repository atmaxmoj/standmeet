// asset_trash.go —— the asset pool's trash (migrations/2026-10-08-asset-trash.sql): a pool delete
// sets deleted_at and keeps the blob; these trash, list, restore and pick what the purge drops.

package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// TrashedAsset —— one file in the trash.
type TrashedAsset struct {
	DeletedAt        time.Time
	ID               string
	OriginalFilename string
}

// PurgeableAsset —— one trashed file past the window: the purge drops its blob, then its row.
type PurgeableAsset struct {
	ID, OwnerID, StorageKey string
}

// Trash —— into the trash (the caller has confirmed it is unreferenced). ErrAssetNotFound when
// the owner has no such live asset.
func (r *AssetRepo) Trash(ctx context.Context, assetID, ownerID string) error {
	n, err := r.flip(ctx, assetID, ownerID, db.New(r.pool).TrashAssetByID)
	if err != nil {
		return fmt.Errorf("trash asset: %w", err)
	}
	if n == 0 {
		return entity.ErrAssetNotFound
	}
	return nil
}

// Restore —— out of the trash. ErrAssetNotInTrash when it is not there.
func (r *AssetRepo) Restore(ctx context.Context, assetID, ownerID string) error {
	restore := func(ctx context.Context, p db.TrashAssetByIDParams) (int64, error) {
		return db.New(r.pool).RestoreAsset(ctx, db.RestoreAssetParams(p))
	}
	n, err := r.flip(ctx, assetID, ownerID, restore)
	if err != nil {
		return fmt.Errorf("restore asset: %w", err)
	}
	if n == 0 {
		return entity.ErrAssetNotInTrash
	}
	return nil
}

// flip —— parses the ids and runs one deleted_at write.
func (*AssetRepo) flip(
	ctx context.Context, assetID, ownerID string,
	write func(context.Context, db.TrashAssetByIDParams) (int64, error),
) (int64, error) {
	asset, err := pgstore.ParseUUID(assetID)
	if err != nil {
		return 0, entity.ErrAssetNotFound // a malformed id names no asset
	}
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return 0, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	return write(ctx, db.TrashAssetByIDParams{ID: asset, OwnerID: owner})
}

// ListTrash —— the owner's trashed files, newest delete first.
func (r *AssetRepo) ListTrash(ctx context.Context, ownerID string) ([]TrashedAsset, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, err := db.New(r.pool).ListTrashedAssets(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("list trashed assets: %w", err)
	}
	out := make([]TrashedAsset, 0, len(rows))
	for i := range rows {
		out = append(out, TrashedAsset{
			ID: pgstore.FormatUUID(rows[i].ID), OriginalFilename: rows[i].OriginalFilename,
			DeletedAt: rows[i].DeletedAt.Time,
		})
	}
	return out, nil
}

// Purgeable —— every file trashed before cutoff, across owners (the purge is instance-wide).
func (r *AssetRepo) Purgeable(ctx context.Context, cutoff time.Time) ([]PurgeableAsset, error) {
	before := pgtype.Timestamptz{Time: cutoff, Valid: true}
	rows, err := db.New(r.pool).ListPurgeableAssets(ctx, before)
	if err != nil {
		return nil, fmt.Errorf("list purgeable assets: %w", err)
	}
	out := make([]PurgeableAsset, 0, len(rows))
	for i := range rows {
		out = append(out, PurgeableAsset{
			ID: pgstore.FormatUUID(rows[i].ID), OwnerID: pgstore.FormatUUID(rows[i].OwnerID),
			StorageKey: rows[i].StorageKey,
		})
	}
	return out, nil
}
