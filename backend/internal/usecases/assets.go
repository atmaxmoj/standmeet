// assets.go —— asset 写流程。没有独立 upload endpoint —— file 上传只发生
// 在 holder (post / wiki / ...) 的 multipart save 事务里：caller (post
// usecase) 开 tx，对每张图调 UploadInTx 上传 MinIO + insert assets 行，
// 全成则 tx.Commit，任何一步失败 caller 在 tx.Rollback 后批删 MinIO blob。

package usecases

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/storage"
)

// AssetsDeps —— 用例打包。Storage 在 composition root fail-fast 检查过，
// 永远 non-nil。
type AssetsDeps struct {
	Repo    *postgres.AssetRepo
	Storage *storage.Client
}

// AssetUploadInput —— 一张图上传所需。caller (post usecase) 从 multipart
// 解出来。fieldalignment: slice (24B) 先于 string (16B)。
type AssetUploadInput struct {
	ContentType      string
	OriginalFilename string
	Body             []byte
}

// UploadInTxResult —— UploadInTx 多返回打包（避开 funcresult-limit）。
// fieldalignment: domain.Asset (大) 先，string 后。
type UploadInTxResult struct {
	StorageKey string
	Asset      domain.Asset
}

// UploadInTx —— 在 caller 给的 tx 里完成"上传到 MinIO + insert assets 行"。
// StorageKey 返给 caller 在 tx rollback 时反向删 blob。
func UploadInTx(
	ctx context.Context, deps AssetsDeps, tx postgres.DBTX,
	holderID string, in *AssetUploadInput,
) (UploadInTxResult, error) {
	id, gerr := newAssetUUID()
	if gerr != nil {
		return UploadInTxResult{}, gerr
	}
	key := holderID + "/" + id
	if perr := putToStorage(ctx, deps, key, in); perr != nil {
		return UploadInTxResult{StorageKey: key}, perr
	}
	asset, cerr := insertAssetRow(ctx, &insertAssetArgs{
		Deps: deps, Tx: tx, ID: id, HolderID: holderID, Key: key, In: in,
	})
	if cerr != nil {
		return UploadInTxResult{StorageKey: key}, cerr
	}
	return UploadInTxResult{Asset: asset, StorageKey: key}, nil
}

// insertAssetArgs —— insertAssetRow 参数打包，避开 argument-limit 5。
type insertAssetArgs struct {
	Tx       postgres.DBTX
	In       *AssetUploadInput
	Deps     AssetsDeps
	ID       string
	HolderID string
	Key      string
}

func insertAssetRow(ctx context.Context, a *insertAssetArgs) (domain.Asset, error) {
	asset, cerr := a.Deps.Repo.CreateTx(ctx, a.Tx, &postgres.CreateAssetInput{
		ID: a.ID, HolderID: a.HolderID, StorageKey: a.Key,
		ContentType: a.In.ContentType, SizeBytes: int64(len(a.In.Body)),
		SHA256: sha256Hex(a.In.Body), OriginalFilename: a.In.OriginalFilename,
	})
	if cerr != nil {
		return domain.Asset{}, fmt.Errorf("create asset row: %w", cerr)
	}
	return asset, nil
}

// DeleteBlobs —— commit/rollback 后 caller 调用，best-effort 批删 MinIO 对象。
// 失败 swallow + 继续；dead blob 业务不可见，对 invariant 无害。
func DeleteBlobs(ctx context.Context, deps AssetsDeps, keys []string) {
	for _, k := range keys {
		if err := deps.Storage.Delete(ctx, k); err != nil {
			_ = err
		}
	}
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
