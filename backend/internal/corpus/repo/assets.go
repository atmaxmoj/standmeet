// assets.go —— CRUD for the assets table. Bytes don't go into the DB (they live in MinIO);
// this only moves metadata. Every row must carry a holder_id (post.id / wiki.id / ...);
// CRUD always runs in the same transaction as the holder operation. So every method
// takes a db.DBTX (can be the pool, or an in-flight tx).

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// AssetRepo —— CRUD for the assets table. pool is the fallback, used for standalone
// reads that don't need a tx; every write path takes a DBTX so the caller can pass in a tx.
type AssetRepo struct {
	pool *pgstore.Pool
}

// NewAssetRepo constructs a repo.
func NewAssetRepo(pool *pgstore.Pool) *AssetRepo { return &AssetRepo{pool: pool} }

// CreateAssetInput —— Create's input. The caller has already generated the UUID (needs
// storage.Put first to get the key) + uploaded the bytes to MinIO + computed the sha256;
// holder_id is the entity this image belongs to (post.id / wiki.id / ...).
type CreateAssetInput struct {
	ID               string
	HolderID         string
	StorageKey       string
	ContentType      string
	SHA256           string
	OriginalFilename string
	Kind             string
	SizeBytes        int64
}

// CreateTx —— writes one assets row inside the caller's tx. Used by the create / update
// post transaction, in the same transaction as the post row insert/update, so it rolls
// back together too.
func (*AssetRepo) CreateTx(
	ctx context.Context, tx db.DBTX, in *CreateAssetInput,
) (entity.Asset, error) {
	params, perr := buildCreateAssetParams(in)
	if perr != nil {
		return entity.Asset{}, perr
	}
	row, err := db.New(tx).CreateAsset(ctx, *params)
	if err != nil {
		return entity.Asset{}, fmt.Errorf("create asset: %w", err)
	}
	return toDomainAsset(&row), nil
}

func buildCreateAssetParams(in *CreateAssetInput) (*db.CreateAssetParams, error) {
	assetUUID, aerr := pgstore.ParseUUID(in.ID)
	if aerr != nil {
		return nil, fmt.Errorf("parse asset id: %w", aerr)
	}
	holderUUID, herr := pgstore.ParseUUID(in.HolderID)
	if herr != nil {
		return nil, fmt.Errorf("parse holder id: %w", herr)
	}
	return &db.CreateAssetParams{
		ID: assetUUID, HolderID: holderUUID,
		StorageKey: in.StorageKey, ContentType: in.ContentType,
		SizeBytes: in.SizeBytes, Sha256: in.SHA256,
		OriginalFilename: in.OriginalFilename,
		Kind:             defaultKind(in.Kind),
	}, nil
}

// defaultKind —— unspecified means it's an inline image. This column was added later, so
// every existing row is an inline image; letting an empty string into the DB would show
// readers an asset with "no kind", which isn't a real state.
func defaultKind(k string) string {
	if k == "" {
		return entity.AssetKindImage
	}
	return k
}

// GetByID —— reads a single row. Goes straight through the pool when the caller has no
// tx; also usable while a tx is in flight.
func (r *AssetRepo) GetByID(ctx context.Context, assetID string) (entity.Asset, error) {
	assetUUID, perr := pgstore.ParseUUID(assetID)
	if perr != nil {
		return entity.Asset{}, fmt.Errorf("parse asset id: %w", perr)
	}
	row, err := db.New(r.pool).GetAssetByID(ctx, assetUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Asset{}, entity.ErrAssetNotFound
		}
		return entity.Asset{}, fmt.Errorf("get asset: %w", err)
	}
	return toDomainAsset(&row), nil
}

// ListByHolderTx —— lists every asset row under one holder. Used before deleting a holder
// to collect storage_keys for the follow-up MinIO cleanup; also used to diff old refs
// after an update body.
func (*AssetRepo) ListByHolderTx(
	ctx context.Context, tx db.DBTX, holderID string,
) ([]entity.Asset, error) {
	return listByHolderUsing(ctx, tx, holderID)
}

// ListByHolder —— goes through the pool (used when there's no tx context). The DELETE
// path lists keys and removes MinIO first, then opens a tx to delete from the DB; this
// listing step doesn't need tx isolation — use this one for it.
func (r *AssetRepo) ListByHolder(
	ctx context.Context, holderID string,
) ([]entity.Asset, error) {
	return listByHolderUsing(ctx, r.pool, holderID)
}

func listByHolderUsing(
	ctx context.Context, dbtx db.DBTX, holderID string,
) ([]entity.Asset, error) {
	holderUUID, perr := pgstore.ParseUUID(holderID)
	if perr != nil {
		return nil, fmt.Errorf("parse holder id: %w", perr)
	}
	rows, err := db.New(dbtx).ListAssetsByHolder(ctx, holderUUID)
	if err != nil {
		return nil, fmt.Errorf("list assets by holder: %w", err)
	}
	out := make([]entity.Asset, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainAsset(&rows[i]))
	}
	return out, nil
}

// DeleteByHolderTx —— deletes every asset row for one holder inside a tx; returns
// storage_keys so the caller can batch-delete the MinIO blobs after commit.
func (*AssetRepo) DeleteByHolderTx(
	ctx context.Context, tx db.DBTX, holderID string,
) ([]string, error) {
	holderUUID, perr := pgstore.ParseUUID(holderID)
	if perr != nil {
		return nil, fmt.Errorf("parse holder id: %w", perr)
	}
	keys, err := db.New(tx).DeleteAssetsByHolder(ctx, holderUUID)
	if err != nil {
		return nil, fmt.Errorf("delete assets by holder: %w", err)
	}
	return keys, nil
}

// DeleteByIDsTx —— deletes a given set of asset ids inside a tx; returns storage_keys.
// Used for the removed refs diffed out during an update body.
func (*AssetRepo) DeleteByIDsTx(
	ctx context.Context, tx db.DBTX, ids []string,
) ([]string, error) {
	if len(ids) == 0 {
		return []string{}, nil
	}
	uuids, perr := pgstore.ParseUUIDArray(ids)
	if perr != nil {
		return []string{}, fmt.Errorf("parse asset ids: %w", perr)
	}
	keys, err := db.New(tx).DeleteAssetsByIDs(ctx, uuids)
	if err != nil {
		return nil, fmt.Errorf("delete assets by ids: %w", err)
	}
	return keys, nil
}

func toDomainAsset(row *db.Asset) entity.Asset {
	return entity.Asset{
		ID:         pgstore.FormatUUID(row.ID),
		HolderID:   pgstore.FormatUUID(row.HolderID),
		StorageKey: row.StorageKey, ContentType: row.ContentType,
		SizeBytes: row.SizeBytes, SHA256: row.Sha256,
		OriginalFilename: row.OriginalFilename,
		Kind:             row.Kind,
		CreatedAt:        row.CreatedAt.Time,
	}
}

// Create —— writes one assets row through the pool (used when there's no tx context).
//
// Attaching an asset is a **separate** step: confirm the entry exists, then fetch the
// bytes, then write this row — not in the same transaction as the entry's write. The old
// writing path submits body text and images together as one multipart request, so it needs
// the same transaction; this address-based path doesn't.
func (r *AssetRepo) Create(
	ctx context.Context, in *CreateAssetInput,
) (entity.Asset, error) {
	return r.CreateTx(ctx, r.pool, in)
}

// DeleteByHolder —— goes through the pool to delete every asset row for one holder;
// returns storage_keys.
func (r *AssetRepo) DeleteByHolder(ctx context.Context, holderID string) ([]string, error) {
	return r.DeleteByHolderTx(ctx, r.pool, holderID)
}

// DeleteByIDs —— goes through the pool to delete a given set of asset ids;
// returns storage_keys.
func (r *AssetRepo) DeleteByIDs(ctx context.Context, ids []string) ([]string, error) {
	return r.DeleteByIDsTx(ctx, r.pool, ids)
}
