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
	"github.com/jackc/pgx/v5/pgtype"

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
type AssetRepo struct {
	pool *pgstore.Pool
}

// NewAssetRepo constructs a repo.
func NewAssetRepo(pool *pgstore.Pool) *AssetRepo { return &AssetRepo{pool: pool} }

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

// ── references ──────────────────────────────────────────────────────────────

// InsertReferenceTx —— record that a referrer uses an asset (idempotent). Inside a tx
// so it commits with the referrer's own row.
func (*AssetRepo) InsertReferenceTx(
	ctx context.Context, tx db.DBTX, assetID, refKind, referrerID string,
) error {
	ids, perr := parseRefIDs(assetID, referrerID)
	if perr != nil {
		return perr
	}
	err := db.New(tx).InsertAssetReference(ctx, db.InsertAssetReferenceParams{
		AssetID: ids.asset, ReferrerKind: refKind, ReferrerID: ids.referrer,
	})
	if err != nil {
		return fmt.Errorf("insert asset reference: %w", err)
	}
	return nil
}

// InsertReference —— pool variant (no tx context): record a use of an asset.
func (r *AssetRepo) InsertReference(
	ctx context.Context, assetID, refKind, referrerID string,
) error {
	return r.InsertReferenceTx(ctx, r.pool, assetID, refKind, referrerID)
}

// DeleteReferencesByReferrerTx —— drop every reference a referrer holds (on its delete,
// or as the first half of a rewrite). Assets survive in the pool.
func (*AssetRepo) DeleteReferencesByReferrerTx(
	ctx context.Context, tx db.DBTX, refKind, referrerID string,
) error {
	referrerUUID, perr := pgstore.ParseUUID(referrerID)
	if perr != nil {
		return fmt.Errorf(errParseReferrerID, perr)
	}
	err := db.New(tx).DeleteAssetReferencesByReferrer(ctx, db.DeleteAssetReferencesByReferrerParams{
		ReferrerKind: refKind, ReferrerID: referrerUUID,
	})
	if err != nil {
		return fmt.Errorf("delete asset references by referrer: %w", err)
	}
	return nil
}

// DeleteReferencesByReferrer —— pool variant (no tx context).
func (r *AssetRepo) DeleteReferencesByReferrer(
	ctx context.Context, refKind, referrerID string,
) error {
	return r.DeleteReferencesByReferrerTx(ctx, r.pool, refKind, referrerID)
}

// DeleteReference —— drop one specific (asset, referrer) reference (a note stops using
// one image). The asset survives.
func (r *AssetRepo) DeleteReference(
	ctx context.Context, assetID, refKind, referrerID string,
) error {
	ids, perr := parseRefIDs(assetID, referrerID)
	if perr != nil {
		return perr
	}
	err := db.New(r.pool).DeleteAssetReference(ctx, db.DeleteAssetReferenceParams{
		AssetID: ids.asset, ReferrerKind: refKind, ReferrerID: ids.referrer,
	})
	if err != nil {
		return fmt.Errorf("delete asset reference: %w", err)
	}
	return nil
}

// CountReferences —— how many referrers use this asset (the delete guard's gate).
func (r *AssetRepo) CountReferences(ctx context.Context, assetID string) (int64, error) {
	assetUUID, perr := pgstore.ParseUUID(assetID)
	if perr != nil {
		return 0, fmt.Errorf(errParseAssetID, perr)
	}
	n, err := db.New(r.pool).CountAssetReferences(ctx, assetUUID)
	if err != nil {
		return 0, fmt.Errorf("count asset references: %w", err)
	}
	return n, nil
}

// ReferencesOf —— who references this asset (feeds the "used by …" message).
func (r *AssetRepo) ReferencesOf(
	ctx context.Context, assetID string,
) ([]entity.AssetReference, error) {
	assetUUID, perr := pgstore.ParseUUID(assetID)
	if perr != nil {
		return nil, fmt.Errorf(errParseAssetID, perr)
	}
	rows, err := db.New(r.pool).ListAssetReferencesByAsset(ctx, assetUUID)
	if err != nil {
		return nil, fmt.Errorf("list asset references: %w", err)
	}
	out := make([]entity.AssetReference, 0, len(rows))
	for i := range rows {
		out = append(out, entity.AssetReference{
			Kind: rows[i].ReferrerKind, ReferrerID: pgstore.FormatUUID(rows[i].ReferrerID),
		})
	}
	return out, nil
}

// ── listing ─────────────────────────────────────────────────────────────────

// ListByReferrer —— the assets one referrer uses (the "files on this entry" view).
func (r *AssetRepo) ListByReferrer(
	ctx context.Context, refKind, referrerID string,
) ([]entity.Asset, error) {
	return listByReferrerUsing(ctx, r.pool, refKind, referrerID)
}

// ListByReferrerTx —— same, inside a tx (diffing during an update).
func (*AssetRepo) ListByReferrerTx(
	ctx context.Context, tx db.DBTX, refKind, referrerID string,
) ([]entity.Asset, error) {
	return listByReferrerUsing(ctx, tx, refKind, referrerID)
}

func listByReferrerUsing(
	ctx context.Context, dbtx db.DBTX, refKind, referrerID string,
) ([]entity.Asset, error) {
	referrerUUID, perr := pgstore.ParseUUID(referrerID)
	if perr != nil {
		return nil, fmt.Errorf(errParseReferrerID, perr)
	}
	rows, err := db.New(dbtx).ListAssetsByReferrer(ctx, db.ListAssetsByReferrerParams{
		ReferrerKind: refKind, ReferrerID: referrerUUID,
	})
	if err != nil {
		return nil, fmt.Errorf("list assets by referrer: %w", err)
	}
	return mapAssets(rows), nil
}

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

// refIDs — a parsed (asset, referrer) id pair (one return value, dodging the
// result-limit).
type refIDs struct{ asset, referrer pgtype.UUID }

func parseRefIDs(assetID, referrerID string) (refIDs, error) {
	asset, err := pgstore.ParseUUID(assetID)
	if err != nil {
		return refIDs{}, fmt.Errorf(errParseAssetID, err)
	}
	referrer, err := pgstore.ParseUUID(referrerID)
	if err != nil {
		return refIDs{}, fmt.Errorf(errParseReferrerID, err)
	}
	return refIDs{asset: asset, referrer: referrer}, nil
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
