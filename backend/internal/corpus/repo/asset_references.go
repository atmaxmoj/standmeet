// asset_references.go —— the asset_references junction: recording, clearing, counting, and
// listing which corpus entries / microsites reference a pool asset (docs/design/global-assets.md).
// The pool CRUD lives in assets.go; this file is everything about the "who uses it" edges the
// delete guard and reference-recompute-on-save are built on.

package repo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

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

// OwnedAssetIDs —— of the given ids, the ones that are real pool assets this owner owns.
// The reference-recompute-on-save filters a note's cited ids through this before writing
// asset_references, so a body that cites a deleted id (or another owner's) neither gets a
// reference nor breaks the save. Unparseable ids are dropped here, not passed to the query.
func (r *AssetRepo) OwnedAssetIDs(
	ctx context.Context, ownerID string, ids []string,
) ([]string, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return nil, fmt.Errorf("parse owner id: %w", perr)
	}
	idUUIDs := parseAssetUUIDs(ids)
	if len(idUUIDs) == 0 {
		return []string{}, nil
	}
	rows, err := db.New(r.pool).FilterOwnedAssetIDs(ctx, db.FilterOwnedAssetIDsParams{
		OwnerID: ownerUUID, Ids: idUUIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("filter owned assets: %w", err)
	}
	return formatAssetUUIDs(rows), nil
}

// parseAssetUUIDs —— parse each id, dropping the unparseable (a body may cite a typo / a
// pending placeholder; neither is a pool asset).
func parseAssetUUIDs(ids []string) []pgtype.UUID {
	out := make([]pgtype.UUID, 0, len(ids))
	for _, id := range ids {
		if u, err := pgstore.ParseUUID(id); err == nil {
			out = append(out, u)
		}
	}
	return out
}

func formatAssetUUIDs(rows []pgtype.UUID) []string {
	out := make([]string, 0, len(rows))
	for i := range rows {
		out = append(out, pgstore.FormatUUID(rows[i]))
	}
	return out
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
