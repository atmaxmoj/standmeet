// pool_upload.go —— uploading a file straight into the owner's global asset pool, with no holder
// and no reference.
//
// Unlike AttachAsset / AttachAssetBytes there is no corpus entry to confirm and nothing to
// reference: the asset lands owner-owned and unreferenced. This is what the design calls
// "pool-first" uploading (docs/design/global-assets.md): adding a new asset just puts it in the
// pool; a corpus entry or a microsite references it later, at save, when its content cites
// standmeet-asset:<id>. Because that content is the single source of truth for "in use", a fresh
// pool asset is immediately deletable until something cites it.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
)

// PoolUploadInput —— one file into the pool. The bytes arrive one of two ways, mirroring
// AttachAsset: the AI/MCP hands a public URL the server fetches; the panel hands the bytes
// directly. Exactly one of URL / Body is set.
type PoolUploadInput struct {
	OwnerID     string
	URL         string
	Kind        string
	Filename    string
	ContentType string
	Body        []byte
}

// UploadPoolAsset —— lands one asset in the pool: accept the media (URL fetch or inline bytes),
// then store it holder-less and unreferenced.
func UploadPoolAsset(
	ctx context.Context, deps AssetsDeps, in *PoolUploadInput,
) (entity.Asset, error) {
	media, merr := acceptPoolMedia(ctx, in)
	if merr != nil {
		return entity.Asset{}, merr
	}
	return storePoolAsset(ctx, deps, in.OwnerID, in.Kind, &media)
}

func acceptPoolMedia(ctx context.Context, in *PoolUploadInput) (FetchedMedia, error) {
	if len(in.Body) > 0 {
		return AcceptMedia(&AcceptMediaInput{
			Filename: in.Filename, Kind: in.Kind, DeclaredCT: in.ContentType, Body: in.Body,
		})
	}
	return FetchMedia(ctx, &FetchMediaInput{URL: in.URL, Kind: in.Kind, Filename: in.Filename})
}

// storePoolAsset —— the same write order as storeAsset (row lands first, blob after, compensate
// on failure) but WITHOUT the final reference insert: a pool upload is holder-less and referenced
// by nothing. NoteID is empty, so holder_id is NULL (an optional breadcrumb only).
func storePoolAsset(
	ctx context.Context, deps AssetsDeps, ownerID, kind string, media *FetchedMedia,
) (entity.Asset, error) {
	prepared, ierr := insertOneAsset(
		ctx, deps,
		&AttachAssetInput{OwnerID: ownerID, NoteID: "", Kind: kind}, media, kindOrImage(kind),
	)
	if ierr != nil {
		return entity.Asset{}, ierr
	}
	if _, uerr := UploadBlobs(ctx, deps, []PreparedAsset{prepared}); uerr != nil {
		// The bytes never made it up, so drop the row. It carries no reference (this upload never
		// inserts one), so this is a clean pool delete; a failed compensation is reported
		// alongside, never swallowed under "upload failed".
		if _, derr := deps.Repo.DeleteByID(ctx, prepared.Asset.ID, ownerID); derr != nil {
			return entity.Asset{}, fmt.Errorf("upload asset: %w (row left behind: %w)", uerr, derr)
		}
		return entity.Asset{}, fmt.Errorf("upload asset: %w", uerr)
	}
	return prepared.Asset, nil
}
