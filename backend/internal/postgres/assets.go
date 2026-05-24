// assets.go —— assets 表 CRUD。bytes 不进库 (在 MinIO)；这里只搬元数据。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// AssetRepo —— assets 表 CRUD。
type AssetRepo struct {
	pool *Pool
}

// NewAssetRepo 构造。
func NewAssetRepo(pool *Pool) *AssetRepo { return &AssetRepo{pool: pool} }

// CreateAssetInput —— Create 入参。caller 已 generate UUID (要先 storage.Put
// 拿 key) + 上传 bytes 到 MinIO + 算好 sha256。
type CreateAssetInput struct {
	ID               string
	OwnerID          string
	StorageKey       string
	ContentType      string
	SHA256           string
	OriginalFilename string
	SizeBytes        int64
}

// Create —— 写一条 assets 行。
func (r *AssetRepo) Create(ctx context.Context, in *CreateAssetInput) (domain.Asset, error) {
	ownerUUID, oerr := parseUUID(in.OwnerID)
	if oerr != nil {
		return domain.Asset{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	assetUUID, perr := parseUUID(in.ID)
	if perr != nil {
		return domain.Asset{}, fmt.Errorf("parse asset id: %w", perr)
	}
	row, err := dbq.New(r.pool).CreateAsset(ctx, dbq.CreateAssetParams{
		ID: assetUUID, OwnerID: ownerUUID, StorageKey: in.StorageKey,
		ContentType: in.ContentType, SizeBytes: in.SizeBytes,
		Sha256: in.SHA256, OriginalFilename: in.OriginalFilename,
	})
	if err != nil {
		return domain.Asset{}, fmt.Errorf("create asset: %w", err)
	}
	return toDomainAsset(&row), nil
}

// GetByID —— 公共 GET endpoint 用（不做 owner 校验：assets 通过 storage
// key 已经携带 owner 隔离；caller 只要能拿到 id 就能读 URL）。
func (r *AssetRepo) GetByID(ctx context.Context, assetID string) (domain.Asset, error) {
	assetUUID, perr := parseUUID(assetID)
	if perr != nil {
		return domain.Asset{}, fmt.Errorf("parse asset id: %w", perr)
	}
	row, err := dbq.New(r.pool).GetAssetByID(ctx, assetUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Asset{}, domain.ErrAssetNotFound
		}
		return domain.Asset{}, fmt.Errorf("get asset: %w", err)
	}
	return toDomainAsset(&row), nil
}

// GetByIDForOwner —— admin 路径用，确保只看到自己的。
func (r *AssetRepo) GetByIDForOwner(
	ctx context.Context, ownerID, assetID string,
) (domain.Asset, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return domain.Asset{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	assetUUID, perr := parseUUID(assetID)
	if perr != nil {
		return domain.Asset{}, fmt.Errorf("parse asset id: %w", perr)
	}
	row, err := dbq.New(r.pool).GetAssetByIDForOwner(ctx, dbq.GetAssetByIDForOwnerParams{
		ID: assetUUID, OwnerID: ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Asset{}, domain.ErrAssetNotFound
		}
		return domain.Asset{}, fmt.Errorf("get asset for owner: %w", err)
	}
	return toDomainAsset(&row), nil
}

// ListByOwner —— admin /assets 视图。
func (r *AssetRepo) ListByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]domain.Asset, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	rows, err := dbq.New(r.pool).ListAssetsByOwner(ctx, dbq.ListAssetsByOwnerParams{
		OwnerID: ownerUUID, Limit: limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list assets: %w", err)
	}
	out := make([]domain.Asset, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainAsset(&rows[i]))
	}
	return out, nil
}

// Delete —— 删 PG 行；调用方应在删 PG 前先删 MinIO 对象 (失败可保留孤儿
// 对象后续清理；PG 行删了之后无法再 presign URL 暴露，安全可接受)。
func (r *AssetRepo) Delete(ctx context.Context, ownerID, assetID string) error {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	assetUUID, perr := parseUUID(assetID)
	if perr != nil {
		return fmt.Errorf("parse asset id: %w", perr)
	}
	if err := dbq.New(r.pool).DeleteAsset(ctx, dbq.DeleteAssetParams{
		ID: assetUUID, OwnerID: ownerUUID,
	}); err != nil {
		return fmt.Errorf("delete asset: %w", err)
	}
	return nil
}

func toDomainAsset(row *dbq.Asset) domain.Asset {
	return domain.Asset{
		ID: formatUUID(row.ID), OwnerID: formatUUID(row.OwnerID),
		StorageKey: row.StorageKey, ContentType: row.ContentType,
		SizeBytes: row.SizeBytes, SHA256: row.Sha256,
		OriginalFilename: row.OriginalFilename,
		CreatedAt:        row.CreatedAt.Time,
	}
}
