// asset_pool.go —— the owner-facing global asset pool (Resources → Assets).
// docs/design/global-assets.md. List the pool, see who references an asset, and delete —
// but only an asset nothing references. The whole point is the delete guard.

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
)

// ErrAssetReferenced —— refuse to delete an asset a corpus entry or microsite still
// references. The caller turns this + ReferencesOf into "used by … — remove those first".
var ErrAssetReferenced = errors.New("asset is still referenced")

// ListPoolAssets —— the owner's whole asset pool, newest first.
func ListPoolAssets(
	ctx context.Context, deps AssetsDeps, ownerID string,
) ([]entity.Asset, error) {
	assets, err := deps.Repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list pool assets: %w", err)
	}
	return assets, nil
}

// ListPoolAssetViews —— the pool with presigned URLs, for the Assets manager UI.
func ListPoolAssetViews(
	ctx context.Context, deps AssetsDeps, ownerID string,
) ([]AssetView, error) {
	assets, err := ListPoolAssets(ctx, deps, ownerID)
	if err != nil {
		return nil, err
	}
	out := make([]AssetView, 0, len(assets))
	for i := range assets {
		out = append(out, assetView(&assets[i]))
	}
	return out, nil
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
	return deleteUnreferenced(ctx, deps, ownerID, &asset)
}

// deleteUnreferenced —— remove an asset already confirmed owned + unreferenced: blob
// first (avoid an orphan blob), then the row.
func deleteUnreferenced(
	ctx context.Context, deps AssetsDeps, ownerID string, asset *entity.Asset,
) error {
	if berr := DeleteBlobsStrict(ctx, deps, []string{asset.StorageKey}); berr != nil {
		return berr
	}
	if _, derr := deps.Repo.DeleteByID(ctx, asset.ID, ownerID); derr != nil {
		return fmt.Errorf("delete asset: %w", derr)
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
