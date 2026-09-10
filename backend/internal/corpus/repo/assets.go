// assets.go —— the global asset pool + asset_references (docs/design/global-assets.md).
// An asset belongs to an owner; corpus entries / microsites reference it. Bytes live in
// MinIO; this only moves metadata. Writes take a db.DBTX so a referrer can create or
// rewrite its references inside the same transaction as its own row.

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

// Referrer kinds for asset_references. A corpus entry or a microsite can reference a
// pool asset; the kind + id say which one, so the delete guard can name it.
const (
	RefKindCorpus    = entity.AssetRefCorpus
	RefKindMicrosite = entity.AssetRefMicrosite
)

// repeated error-wrap formats (revive: add-constant).
const (
	errParseAssetID    = "parse asset id: %w"
	errParseReferrerID = "parse referrer id: %w"
)

// AssetRepo —— CRUD for the assets pool + references. pool is the fallback for reads /
// standalone writes; every write also has a Tx variant taking a caller's transaction.
//
// urlKey is the server key an authorized render signs a gated asset's serve URL with
// (usecase.SignAssetURL) — carried here because the repo is the one dependency already
// threaded to every URL-emitting site. The repo itself does no crypto; it only hands the
// key to the usecase layer, keeping crypto out of the repo package.
type AssetRepo struct {
	pool   *pgstore.Pool
	urlKey string
}

// NewAssetRepo constructs a repo. urlKey (the instance SESSION_KEY) signs gated asset URLs.
func NewAssetRepo(pool *pgstore.Pool, urlKey string) *AssetRepo {
	return &AssetRepo{pool: pool, urlKey: urlKey}
}

// URLKey — the key used to sign this asset's serve URL. See usecase.SignAssetURL.
func (r *AssetRepo) URLKey() string { return r.urlKey }

// CreateAssetInput —— a new pool asset. OwnerID is required (the pool is owner-scoped);
// HolderID is an optional breadcrumb (the note an inline image came from) — never the
// authority on "in use", which is asset_references.
type CreateAssetInput struct {
	ID               string
	OwnerID          string
	HolderID         string
	StorageKey       string
	ContentType      string
	SHA256           string
	OriginalFilename string
	Kind             string
	SizeBytes        int64
}

// CreateTx —— writes one assets row inside the caller's tx.
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

// Create —— writes one assets row through the pool (no tx context).
func (r *AssetRepo) Create(ctx context.Context, in *CreateAssetInput) (entity.Asset, error) {
	return r.CreateTx(ctx, r.pool, in)
}

func buildCreateAssetParams(in *CreateAssetInput) (*db.CreateAssetParams, error) {
	assetUUID, aerr := pgstore.ParseUUID(in.ID)
	if aerr != nil {
		return nil, fmt.Errorf(errParseAssetID, aerr)
	}
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf("parse owner id: %w", oerr)
	}
	holderUUID, herr := pgstore.ParseOptionalUUID(&in.HolderID)
	if herr != nil {
		return nil, fmt.Errorf("parse holder id: %w", herr)
	}
	return &db.CreateAssetParams{
		ID: assetUUID, OwnerID: ownerUUID, HolderID: holderUUID,
		StorageKey: in.StorageKey, ContentType: in.ContentType,
		SizeBytes: in.SizeBytes, Sha256: in.SHA256,
		OriginalFilename: in.OriginalFilename,
		Kind:             defaultKind(in.Kind),
	}, nil
}

// defaultKind —— unspecified means an inline image (the column was added later).
func defaultKind(k string) string {
	if k == "" {
		return entity.AssetKindImage
	}
	return k
}

// GetByID —— reads a single row through the pool.
func (r *AssetRepo) GetByID(ctx context.Context, assetID string) (entity.Asset, error) {
	assetUUID, perr := pgstore.ParseUUID(assetID)
	if perr != nil {
		return entity.Asset{}, fmt.Errorf(errParseAssetID, perr)
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

// The asset_references junction (record / clear / count / list-by-referrer / owner-filter) lives
// in asset_references.go — this file is the pool CRUD.

// ListByOwner —— the whole pool for one owner (the Assets manager).
func (r *AssetRepo) ListByOwner(ctx context.Context, ownerID string) ([]entity.Asset, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return nil, fmt.Errorf("parse owner id: %w", perr)
	}
	rows, err := db.New(r.pool).ListAssetsByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list assets by owner: %w", err)
	}
	return mapAssets(rows), nil
}

// ── pool delete ───────────────────────────────────────────────────────────────

// DeleteByID —— delete one asset the caller has already confirmed is unreferenced,
// scoped to owner. Returns storage_key for the follow-up MinIO cleanup.
func (r *AssetRepo) DeleteByID(
	ctx context.Context, assetID, ownerID string,
) (string, error) {
	assetUUID, oerr := pgstore.ParseUUID(assetID)
	if oerr != nil {
		return "", fmt.Errorf(errParseAssetID, oerr)
	}
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return "", fmt.Errorf("parse owner id: %w", perr)
	}
	key, err := db.New(r.pool).DeleteAssetByID(ctx, db.DeleteAssetByIDParams{
		ID: assetUUID, OwnerID: ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", entity.ErrAssetNotFound
		}
		return "", fmt.Errorf("delete asset: %w", err)
	}
	return key, nil
}

func mapAssets(rows []db.Asset) []entity.Asset {
	out := make([]entity.Asset, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainAsset(&rows[i]))
	}
	return out
}

func toDomainAsset(row *db.Asset) entity.Asset {
	return entity.Asset{
		ID:         pgstore.FormatUUID(row.ID),
		OwnerID:    pgstore.FormatUUID(row.OwnerID),
		HolderID:   pgstore.FormatUUID(row.HolderID),
		StorageKey: row.StorageKey, ContentType: row.ContentType,
		SizeBytes: row.SizeBytes, SHA256: row.Sha256,
		OriginalFilename: row.OriginalFilename,
		Kind:             row.Kind,
		CreatedAt:        row.CreatedAt.Time,
	}
}
