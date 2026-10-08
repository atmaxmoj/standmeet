// asset_pool.go —— the owner-facing global asset pool (Resources → Assets).
// docs/design/global-assets.md. List the pool, see who references an asset, and delete —
// but only an asset nothing references. The whole point is the delete guard. A delete lands
// in the trash for 90 days (migrations/2026-10-08-asset-trash.sql).

package usecase

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

// ErrAssetReferenced —— refuse to delete an asset a corpus entry or microsite still
// references. The caller turns this + ReferencesOf into "used by … — remove those first".
var ErrAssetReferenced = errors.New("asset is still referenced")

// ListPoolAssets —— one page of the owner's asset pool, newest first.
func ListPoolAssets(
	ctx context.Context, deps AssetsDeps, ownerID string, f repo.AssetFilter, req paging.Request,
) (paging.Page[entity.Asset], error) {
	page, err := deps.Repo.ListPage(ctx, ownerID, f, req)
	if err != nil {
		return paging.Page[entity.Asset]{}, fmt.Errorf("list pool assets: %w", err)
	}
	return page, nil
}

// ListPoolAssetViews —— one page of the pool with presigned URLs, for the Assets manager UI.
func ListPoolAssetViews(
	ctx context.Context, deps AssetsDeps, ownerID string, f repo.AssetFilter, req paging.Request,
) (paging.Page[AssetView], error) {
	page, err := ListPoolAssets(ctx, deps, ownerID, f, req)
	if err != nil {
		return paging.Page[AssetView]{}, err
	}
	return paging.Each(page, func(a *entity.Asset) AssetView {
		return assetView(a, deps.Repo)
	}), nil
}

// AssetReferences —— who references one asset (the "used by …" list). Scoped to owner:
// another owner's asset reads back as not found, not as an empty reference list.
func AssetReferences(
	ctx context.Context, deps AssetsDeps, ownerID, assetID string,
) ([]entity.AssetReference, error) {
	if _, err := ownedAsset(ctx, deps, ownerID, assetID); err != nil {
		return nil, err
	}
	refs, err := deps.Repo.ReferencesOf(ctx, assetID)
	if err != nil {
		return nil, fmt.Errorf("asset references: %w", err)
	}
	return refs, nil
}

// DeletePoolAsset —— the guarded delete. Refuses (ErrAssetReferenced) while any corpus
// entry or microsite references the asset; only an unreferenced asset is removed (blob
// first, then row, matching the delete-order invariant elsewhere).
//
// ponytail: the guard is read-then-delete, not one atomic statement — fine for a
// single-owner instance where the only writer of references is the owner themselves;
// make DeleteAssetByID conditional on NOT EXISTS(references) if real concurrency arrives.
func DeletePoolAsset(
	ctx context.Context, deps AssetsDeps, ownerID, assetID string,
) error {
	asset, err := ownedAsset(ctx, deps, ownerID, assetID)
	if err != nil {
		return err
	}
	n, cerr := deps.Repo.CountReferences(ctx, assetID)
	if cerr != nil {
		return fmt.Errorf("count references: %w", cerr)
	}
	if n > 0 {
		return ErrAssetReferenced
	}
	// Into the trash, blob kept: the purge (AssetTrashPeriodicJobs) drops both 90 days on.
	return deps.Repo.Trash(ctx, asset.ID, ownerID)
}

// TrashedAssets —— the owner's files in the trash.
func TrashedAssets(
	ctx context.Context, deps AssetsDeps, ownerID string,
) ([]repo.TrashedAsset, error) {
	return deps.Repo.ListTrash(ctx, ownerID)
}

// RestoreAsset —— takes a file out of the trash; its blob was never dropped.
func RestoreAsset(ctx context.Context, deps AssetsDeps, ownerID, assetID string) error {
	return deps.Repo.Restore(ctx, assetID, ownerID)
}

// AssetTrashPeriodicJobs —— the daily purge of files trashed longer than entity.TrashRetention:
// blob first (no orphan blob is left behind a deleted row), then the row. A nil repo or storage
// exposes none: a panel must not show a job that reports "ok" while doing nothing.
func AssetTrashPeriodicJobs(deps AssetsDeps) []periodic.Job {
	if deps.Repo == nil || deps.Storage == nil {
		return []periodic.Job{}
	}
	return []periodic.Job{periodic.Named("asset trash purge", trashPurgeEvery,
		func(ctx context.Context) error { return purgeAssetTrash(ctx, deps) })}
}

func purgeAssetTrash(ctx context.Context, deps AssetsDeps) error {
	due, err := deps.Repo.Purgeable(ctx, time.Now().UTC().Add(-entity.TrashRetention))
	if err != nil {
		return err
	}
	for i := range due {
		if berr := DeleteBlobsStrict(ctx, deps, []string{due[i].StorageKey}); berr != nil {
			return berr
		}
		if _, derr := deps.Repo.DeleteByID(ctx, due[i].ID, due[i].OwnerID); derr != nil {
			return fmt.Errorf("purge asset: %w", derr)
		}
	}
	return nil
}

// ownedAsset —— fetch an asset and confirm it belongs to this owner. A mismatch reads
// back as ErrAssetNotFound (no existence leak across owners).
func ownedAsset(
	ctx context.Context, deps AssetsDeps, ownerID, assetID string,
) (entity.Asset, error) {
	asset, err := deps.Repo.GetByID(ctx, assetID)
	if err != nil {
		return entity.Asset{}, fmt.Errorf("load asset: %w", err)
	}
	if asset.OwnerID != ownerID {
		return entity.Asset{}, entity.ErrAssetNotFound
	}
	return asset, nil
}
