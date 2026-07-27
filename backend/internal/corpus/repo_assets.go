// assets.go —— assets 表 CRUD。bytes 不进库 (在 MinIO)；这里只搬元数据。
// 每行必须挂 holder_id (post.id / wiki.id / ...)；CRUD 永远在 holder 操作
// 的同事务里完成。所以所有 method 都接 db.DBTX（可以是 pool，也可以是
// 进行中的 tx）。

package corpus

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// AssetRepo —— assets 表 CRUD。pool 是 fallback，单独读不需要 tx 时用；
// 写 path 都接 DBTX 让 caller 传进 tx。
type AssetRepo struct {
	pool *pgstore.Pool
}

// NewAssetRepo 构造。
func NewAssetRepo(pool *pgstore.Pool) *AssetRepo { return &AssetRepo{pool: pool} }

// CreateAssetInput —— Create 入参。caller 已 generate UUID (要先 storage.Put
// 拿 key) + 上传 bytes 到 MinIO + 算好 sha256；holder_id 是这张图归属的
// 实体 (post.id / wiki.id / ...)。
type CreateAssetInput struct {
	ID               string
	HolderID         string
	StorageKey       string
	ContentType      string
	SHA256           string
	OriginalFilename string
	SizeBytes        int64
}

// CreateTx —— 在 caller 给的 tx 里写一条 assets 行。create / update post
// 的事务用它，跟 post 行 insert/update 同事务，rollback 也一起。
func (*AssetRepo) CreateTx(
	ctx context.Context, tx db.DBTX, in *CreateAssetInput,
) (Asset, error) {
	params, perr := buildCreateAssetParams(in)
	if perr != nil {
		return Asset{}, perr
	}
	row, err := db.New(tx).CreateAsset(ctx, *params)
	if err != nil {
		return Asset{}, fmt.Errorf("create asset: %w", err)
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
	}, nil
}

// GetByID —— 单条读。caller 不需要 tx 时直接走 pool；tx 进行中也能用。
func (r *AssetRepo) GetByID(ctx context.Context, assetID string) (Asset, error) {
	assetUUID, perr := pgstore.ParseUUID(assetID)
	if perr != nil {
		return Asset{}, fmt.Errorf("parse asset id: %w", perr)
	}
	row, err := db.New(r.pool).GetAssetByID(ctx, assetUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Asset{}, ErrAssetNotFound
		}
		return Asset{}, fmt.Errorf("get asset: %w", err)
	}
	return toDomainAsset(&row), nil
}

// ListByHolderTx —— 列一个 holder 名下所有 asset 行。delete holder 前用来
// 收 storage_key 给后置 MinIO 清；update body 后 diff old refs 也用。
func (*AssetRepo) ListByHolderTx(
	ctx context.Context, tx db.DBTX, holderID string,
) ([]Asset, error) {
	return listByHolderUsing(ctx, tx, holderID)
}

// ListByHolder —— 走 pool（无 tx 上下文时用）。DELETE 路径先列 keys 删
// MinIO 再开 tx 删 DB，列这步不需要 tx 隔离 —— 用这条。
func (r *AssetRepo) ListByHolder(
	ctx context.Context, holderID string,
) ([]Asset, error) {
	return listByHolderUsing(ctx, r.pool, holderID)
}

func listByHolderUsing(
	ctx context.Context, dbtx db.DBTX, holderID string,
) ([]Asset, error) {
	holderUUID, perr := pgstore.ParseUUID(holderID)
	if perr != nil {
		return nil, fmt.Errorf("parse holder id: %w", perr)
	}
	rows, err := db.New(dbtx).ListAssetsByHolder(ctx, holderUUID)
	if err != nil {
		return nil, fmt.Errorf("list assets by holder: %w", err)
	}
	out := make([]Asset, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainAsset(&rows[i]))
	}
	return out, nil
}

// DeleteByHolderTx —— 在 tx 里删一个 holder 的所有 asset 行；返 storage_keys
// 让 caller commit 后批删 MinIO blob。
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

// DeleteByIDsTx —— 在 tx 里删指定 asset id 集合；返 storage_keys。update
// body 时 diff 出来的 removed refs 用。
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

func toDomainAsset(row *db.Asset) Asset {
	return Asset{
		ID:         pgstore.FormatUUID(row.ID),
		HolderID:   pgstore.FormatUUID(row.HolderID),
		StorageKey: row.StorageKey, ContentType: row.ContentType,
		SizeBytes: row.SizeBytes, SHA256: row.Sha256,
		OriginalFilename: row.OriginalFilename,
		CreatedAt:        row.CreatedAt.Time,
	}
}
