// assets.go —— the asset write flow. Invariant: blob lifecycle ⊆ post lifecycle —
// at any moment, a blob existing in MinIO ⇒ its corresponding holder + asset row
// also exists in the DB.
//
// Implementation:
//   - InsertAssetRowTx: only inserts the assets row inside the caller's given tx
//     (uuid pre-generated, storage_key already determined), **doesn't touch MinIO**.
//   - UploadBlob: the caller calls this after the tx commits, PUTting the prepared
//     bytes to MinIO.
//
// "DB row commits first, blob uploads after" turns the failure mode from a "silent
// MinIO orphan" into a "visible broken post." The latter is visible in the owner's
// UI, and on upload failure the caller runs a compensating DeletePostWithAssets to
// roll the post back — the owner can just re-submit.
//
// The matching DELETE order is flipped in DeletePostWithAssets: MinIO deletes first
// (strict), the DB tx deletes after. This likewise guarantees no silent blob leak.

package usecase

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
)

// AssetsDeps —— usecase dependency bundle. Storage is fail-fast checked at the
// composition root, so it's always non-nil.
type AssetsDeps struct {
	Repo    *repo.AssetRepo
	Storage *storage.Client
}

// AssetUploadInput —— what's needed to upload one image. The caller (post usecase)
// decodes this out of multipart. PendingID is a client-side placeholder (a uuid the
// frontend editor supplies, written into body_md as `standmeet-asset:pending-<id>`),
// kept around so InsertAssetRowTx can pass it through into PreparedAsset.
// fieldalignment: slice (24B) before string (16B).
type AssetUploadInput struct {
	ContentType      string
	OriginalFilename string
	PendingID        string
	// Kind —— 'image' | 'attachment'. Empty = image (this column was added later;
	// every existing path is an illustration).
	Kind string
	Body []byte
}

// PreparedAsset —— InsertAssetRowTx's return value. Body + ContentType are kept
// around for UploadBlobs to use after the tx commits; PendingID is kept around for
// writePostBody to substitute into body_md. fieldalignment: slice (24B) first,
// string (16B) after, embedded struct last.
type PreparedAsset struct {
	Body        []byte
	PendingID   string
	ContentType string
	Asset       entity.Asset
}

// InsertAssetRowTx —— inserts the assets row inside the caller's given tx (doesn't
// touch MinIO). Pre-generates uuid + storage_key so the post body_md rewrite can get
// the real id right away. Returns PreparedAsset so the caller can call UploadBlobs
// after the tx commits to actually push the bytes to MinIO. in.PendingID is passed
// through to the return value so the caller can build the rewrite map in one pass.
func InsertAssetRowTx(
	ctx context.Context, deps AssetsDeps, tx pgstore.DBTX,
	holderID string, in *AssetUploadInput,
) (PreparedAsset, error) {
	id, gerr := newAssetUUID()
	if gerr != nil {
		return PreparedAsset{}, gerr
	}
	key := holderID + "/" + id
	asset, cerr := insertAssetRow(ctx, &insertAssetArgs{
		Deps: deps, Tx: tx, ID: id, HolderID: holderID, Key: key, In: in,
	})
	if cerr != nil {
		return PreparedAsset{}, cerr
	}
	return PreparedAsset{
		Asset: asset, Body: in.Body,
		ContentType: in.ContentType, PendingID: in.PendingID,
	}, nil
}

// insertAssetArgs —— insertAssetRow's argument bundle, to dodge the argument-limit
// of 5.
type insertAssetArgs struct {
	Tx       pgstore.DBTX
	In       *AssetUploadInput
	Deps     AssetsDeps
	ID       string
	HolderID string
	Key      string
}

func insertAssetRow(ctx context.Context, a *insertAssetArgs) (entity.Asset, error) {
	asset, cerr := a.Deps.Repo.CreateTx(ctx, a.Tx, &repo.CreateAssetInput{
		ID: a.ID, HolderID: a.HolderID, StorageKey: a.Key,
		ContentType: a.In.ContentType, SizeBytes: int64(len(a.In.Body)),
		SHA256: sha256Hex(a.In.Body), OriginalFilename: a.In.OriginalFilename,
		Kind: a.In.Kind,
	})
	if cerr != nil {
		return entity.Asset{}, fmt.Errorf("create asset row: %w", cerr)
	}
	return asset, nil
}

// UploadBlobs —— the caller calls this after the tx commits, PUTting the prepared
// bytes to MinIO in order. Any failure immediately returns an error for the caller
// to run a compensating delete; returns the list of storage_keys that already
// succeeded so the caller can clean up that part of the blobs too.
func UploadBlobs(
	ctx context.Context, deps AssetsDeps, prepared []PreparedAsset,
) ([]string, error) {
	done := make([]string, 0, len(prepared))
	for i := range prepared {
		p := &prepared[i]
		if err := putToStorage(ctx, deps, p.Asset.StorageKey, &AssetUploadInput{
			Body: p.Body, ContentType: p.ContentType,
		}); err != nil {
			return done, fmt.Errorf("upload %s: %w", p.Asset.StorageKey, err)
		}
		done = append(done, p.Asset.StorageKey)
	}
	return done, nil
}

// DeleteBlobs —— the reverse cleanup. After a compensating delete, cleans up the
// portion of blobs already uploaded. Failures are swallowed and it continues
// (best-effort, for the rare double-fault case).
func DeleteBlobs(ctx context.Context, deps AssetsDeps, keys []string) {
	for _, k := range keys {
		if err := deps.Storage.Delete(ctx, k); err != nil {
			_ = err
		}
	}
}

// DeleteBlobsStrict —— used on the DELETE path. Any deletion failure immediately
// returns an error, and the DB tx never starts. Invariant: DB rows are touched only
// after all blobs are deleted, avoiding a silent orphan where the DB is deleted but
// the blob remains. MinIO's RemoveObject is idempotent (S3 spec returns 204 even for
// a non-existent object), so an owner retry is safe.
func DeleteBlobsStrict(ctx context.Context, deps AssetsDeps, keys []string) error {
	for _, k := range keys {
		if err := deps.Storage.Delete(ctx, k); err != nil {
			return fmt.Errorf("delete blob %s: %w", k, err)
		}
	}
	return nil
}

func putToStorage(
	ctx context.Context, deps AssetsDeps, key string, in *AssetUploadInput,
) error {
	if err := deps.Storage.Put(ctx, &storage.PutInput{
		Body:        bytes.NewReader(in.Body),
		Key:         key,
		ContentType: in.ContentType,
		Size:        int64(len(in.Body)),
	}); err != nil {
		return fmt.Errorf("put storage: %w", err)
	}
	return nil
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func newAssetUUID() (string, error) {
	u, err := uuid.NewRandom()
	if err != nil {
		return "", fmt.Errorf("gen asset uuid: %w", err)
	}
	return u.String(), nil
}
