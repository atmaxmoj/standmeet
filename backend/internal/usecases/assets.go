// assets.go —— owner-uploaded 图片/附件 use case。流程：
//   admin UI → POST /api/admin/assets (multipart)
//     → usecases.UploadAsset:
//         1. 算 sha256
//         2. derive key = "<owner_id>/<uuid>"
//         3. storage.Put bytes
//         4. assets repo.Create 行
//     → 返回 {asset_id, public_url}
//
//   visitor / public GET /api/v1/assets/<id>
//     → usecases.ResolveAssetURL:
//         1. assets repo.GetByID (公共，不做 owner 校验：URL 是 capability)
//         2. storage.PresignedGetURL → 302 redirect
//
// 写 path 没做 ACL —— admin 已经过 owner session；MCP `attach_media` (后
// 续 raw_dump / post_create 用) 走 MCP token 鉴权。
//
// 删 path：先 storage.Delete (失败 log + 继续) 再 repo.Delete；保证 PG
// 行删干净，孤儿对象后续 GC。

package usecases

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"

	"github.com/google/uuid"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/storage"
)

// newAssetUUID —— app-side 生成 id；要在 storage.Put 前知道 key，所以
// 不能等 PG default 生成。
func newAssetUUID() (string, error) {
	u, err := uuid.NewRandom()
	if err != nil {
		return "", fmt.Errorf("gen asset uuid: %w", err)
	}
	return u.String(), nil
}

// AssetsDeps —— 用例打包。Storage 在 composition root fail-fast 检查过，
// 永远 non-nil；e2e 同样的 minio 容器，无 mock。
type AssetsDeps struct {
	Repo    *postgres.AssetRepo
	Storage *storage.Client
}

// UploadAssetInput —— UploadAsset 入参。Body 是 reader，caller 已 cap 大小
// (admin route 处用 http.MaxBytesReader)。
type UploadAssetInput struct {
	Body             io.Reader
	OwnerID          string
	ContentType      string
	OriginalFilename string
	SizeBytes        int64
}

// UploadAssetResult —— 入库 + 上传后的元数据。字段按 govet fieldalignment
// 排：domain.Asset (大块) 先，string 头部 16B 后。
type UploadAssetResult struct {
	PublicURL string // 即时 presigned
	Asset     domain.Asset
}

// hashedBody —— readAndHash 的打包返回，避开 funcresult-limit。字段顺序
// 按 govet fieldalignment：string (16B) 先，slice (24B) 后。
type hashedBody struct {
	SHA256 string
	Bytes  []byte
}

// UploadAsset —— 接住 multipart body：读 bytes → sha256 → storage.Put →
// repo.Create → presign URL 返。Storage 来自 composition root，永远 non-nil
// (disabled 时是 DisabledClient，方法直接返 ErrDisabled，自然 propagate)。
func UploadAsset(
	ctx context.Context, deps AssetsDeps, in *UploadAssetInput,
) (UploadAssetResult, error) {
	if in.OwnerID == "" {
		return UploadAssetResult{}, ErrEmptyField
	}
	hashed, rerr := readAndHash(in.Body)
	if rerr != nil {
		return UploadAssetResult{}, rerr
	}
	return persistAsset(ctx, deps, in, hashed)
}

func readAndHash(body io.Reader) (hashedBody, error) {
	raw, err := io.ReadAll(body)
	if err != nil {
		return hashedBody{}, fmt.Errorf("read asset body: %w", err)
	}
	sum := sha256.Sum256(raw)
	return hashedBody{Bytes: raw, SHA256: hex.EncodeToString(sum[:])}, nil
}

func persistAsset(
	ctx context.Context, deps AssetsDeps, in *UploadAssetInput, hashed hashedBody,
) (UploadAssetResult, error) {
	assetUUID, gerr := newAssetUUID()
	if gerr != nil {
		return UploadAssetResult{}, gerr
	}
	key := in.OwnerID + "/" + assetUUID
	if perr := putToStorage(ctx, deps, key, in.ContentType, hashed.Bytes); perr != nil {
		return UploadAssetResult{}, perr
	}
	asset, cerr := createAssetRow(ctx, deps, &createAssetArgs{
		in: in, key: key, sha: hashed.SHA256, size: int64(len(hashed.Bytes)),
	})
	if cerr != nil {
		return UploadAssetResult{}, cerr
	}
	return buildUploadResult(ctx, deps, &asset)
}

func putToStorage(
	ctx context.Context, deps AssetsDeps, key, contentType string, data []byte,
) error {
	if perr := deps.Storage.Put(ctx, &storage.PutInput{
		Body:        bytes.NewReader(data),
		Key:         key,
		ContentType: contentType,
		Size:        int64(len(data)),
	}); perr != nil {
		return fmt.Errorf("put storage: %w", perr)
	}
	return nil
}

// createAssetArgs —— createAssetRow 入参打包；revive argument-limit ≤ 5。
type createAssetArgs struct {
	in   *UploadAssetInput
	key  string
	sha  string
	size int64
}

func createAssetRow(
	ctx context.Context, deps AssetsDeps, a *createAssetArgs,
) (domain.Asset, error) {
	assetID := lastSegment(a.key)
	asset, err := deps.Repo.Create(ctx, &postgres.CreateAssetInput{
		ID: assetID, OwnerID: a.in.OwnerID, StorageKey: a.key,
		ContentType: a.in.ContentType, SizeBytes: a.size, SHA256: a.sha,
		OriginalFilename: a.in.OriginalFilename,
	})
	if err != nil {
		return domain.Asset{}, fmt.Errorf("create asset row: %w", err)
	}
	return asset, nil
}

func buildUploadResult(
	ctx context.Context, deps AssetsDeps, asset *domain.Asset,
) (UploadAssetResult, error) {
	url, uerr := deps.Storage.PresignedGetURL(ctx, asset.StorageKey)
	if uerr != nil {
		return UploadAssetResult{}, fmt.Errorf("presign url: %w", uerr)
	}
	return UploadAssetResult{Asset: *asset, PublicURL: url}, nil
}

// lastSegment —— key 形态 "owner_id/asset_id"，取 asset_id 部分。
func lastSegment(s string) string {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == '/' {
			return s[i+1:]
		}
	}
	return s
}

// ResolveAssetResult —— ResolveAssetURL 返回打包。
type ResolveAssetResult struct {
	URL   string
	Asset domain.Asset
}

// ResolveAssetURL —— 公共 GET /api/v1/assets/{id} 用：查 PG → 即时 presign。
func ResolveAssetURL(
	ctx context.Context, deps AssetsDeps, assetID string,
) (ResolveAssetResult, error) {
	asset, err := deps.Repo.GetByID(ctx, assetID)
	if err != nil {
		if errors.Is(err, domain.ErrAssetNotFound) {
			return ResolveAssetResult{}, domain.ErrAssetNotFound
		}
		return ResolveAssetResult{}, fmt.Errorf("get asset: %w", err)
	}
	url, uerr := deps.Storage.PresignedGetURL(ctx, asset.StorageKey)
	if uerr != nil {
		return ResolveAssetResult{}, fmt.Errorf("presign url: %w", uerr)
	}
	return ResolveAssetResult{URL: url, Asset: asset}, nil
}

// ListAssets —— admin /assets 列表。limit 0 → 50。
func ListAssets(
	ctx context.Context, deps AssetsDeps, ownerID string, limit int32,
) ([]domain.Asset, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
	}
	if limit <= 0 {
		limit = defaultAssetsListLimit
	}
	rows, err := deps.Repo.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list assets: %w", err)
	}
	return rows, nil
}

const defaultAssetsListLimit = 50

// DeleteAsset —— admin 删；先删 MinIO 对象 (失败 swallow，避免孤儿 PG
// 行)，再删 PG。
func DeleteAsset(
	ctx context.Context, deps AssetsDeps, ownerID, assetID string,
) error {
	if ownerID == "" || assetID == "" {
		return ErrEmptyField
	}
	asset, gerr := deps.Repo.GetByIDForOwner(ctx, ownerID, assetID)
	if gerr != nil {
		return fmt.Errorf("get asset: %w", gerr)
	}
	bestEffortStorageDelete(ctx, deps, asset.StorageKey)
	if derr := deps.Repo.Delete(ctx, ownerID, assetID); derr != nil {
		return fmt.Errorf("delete asset row: %w", derr)
	}
	return nil
}

// bestEffortStorageDelete —— Storage 永远 non-nil (composition root
// 注 DisabledClient 而非 nil)。失败 swallow，保证 PG 行能删干净。
func bestEffortStorageDelete(ctx context.Context, deps AssetsDeps, key string) {
	if err := deps.Storage.Delete(ctx, key); err != nil {
		_ = err
	}
}
