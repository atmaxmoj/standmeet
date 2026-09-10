// note_asset_dedup.go —— asset-upload dedup on the attach path.
//
// The same file re-referenced (another entry, a re-run vault sync, a re-pasted image) must reuse
// the one pool asset, never mint a second byte-identical row. The dedup key is **name + content**
// (the owner's call): same filename AND same bytes = the same file; a different name, or different
// bytes, is a distinct asset. Covered by e2e/test/asset-upload-dedup.spec.ts.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// storeAssetDedup —— dedup, then store. If this owner already has a pool asset with the same
// filename AND the same bytes, reuse it (reference it from this note); otherwise fall through to a
// fresh upload. Kept a wrapper so storeAsset stays at its cyclomatic-complexity cap.
func storeAssetDedup(
	ctx context.Context, deps AssetsDeps, in *AttachAssetInput, media *FetchedMedia,
) (entity.Asset, error) {
	existing, err := reuseExistingAsset(ctx, deps, in, media)
	if err != nil {
		return entity.Asset{}, err
	}
	if existing.ID != "" {
		return existing, nil
	}
	return storeAsset(ctx, deps, in, media)
}

// reuseExistingAsset —— when a byte-identical same-name asset already exists, reference it from
// this note and return it; otherwise return a zero-value asset (empty ID) = "nothing to reuse".
// The reference-only short-circuit never runs storeAsset's compensating-delete, which would
// otherwise delete the reused pre-existing asset on an upload retry.
func reuseExistingAsset(
	ctx context.Context, deps AssetsDeps, in *AttachAssetInput, media *FetchedMedia,
) (entity.Asset, error) {
	existing, err := deps.Repo.FindByContentKey(
		ctx, in.OwnerID, media.Filename, sha256Hex(media.Body),
	)
	if err != nil {
		return entity.Asset{}, fmt.Errorf("dedup lookup: %w", err)
	}
	if existing.ID == "" {
		return entity.Asset{}, nil
	}
	rerr := deps.Repo.InsertReference(ctx, existing.ID, repo.RefKindCorpus, in.NoteID)
	if rerr != nil {
		return entity.Asset{}, fmt.Errorf("reference asset: %w", rerr)
	}
	return existing, nil
}
