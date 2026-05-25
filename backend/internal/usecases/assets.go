// assets.go —— asset 写流程。invariant: blob 生命周期 ⊆ post 生命周期，
// 任何时刻 MinIO 里 blob 存在 ⇒ DB 里对应 holder + asset 行也存在。
//
// 实现：
//   - InsertAssetRowTx：caller 给的 tx 里只 insert assets 行（uuid 预生成，
//     storage_key 已确定），**不动 MinIO**。
//   - UploadBlob：tx commit 之后 caller 调，把 prepared bytes PUT 到 MinIO。
//
// "DB 行先 commit，blob 后传" 把失败模式从"silent MinIO orphan"换成
// "visible broken post"。后者 owner UI 看得见，且 caller 在 upload 失败
// 时跑 compensating DeletePostWithAssets 把 post 卷掉，owner re-submit 就行。
//
// 对应的 DELETE 顺序在 DeletePostWithAssets 里翻过来：MinIO 先删（strict），
// DB tx 后删。同样保证 blob 不会 silent leak。

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
// 解出来。PendingID 是 client-side 占位符（前端 editor 给的 uuid，body_md
// 里写 `standmeet-asset:pending-<id>`），保留下来好让 InsertAssetRowTx
// 把它透传进 PreparedAsset。fieldalignment: slice (24B) 先于 string (16B)。
type AssetUploadInput struct {
	ContentType      string
	OriginalFilename string
	PendingID        string
	Body             []byte
}

// PreparedAsset —— InsertAssetRowTx 返回。Body + ContentType 留着等 tx
// commit 之后 UploadBlobs 用；PendingID 留着等 writePostBody 替 body_md。
// fieldalignment: slice (24B) 先，string (16B) 后，embedded struct 最后。
type PreparedAsset struct {
	Body        []byte
	PendingID   string
	ContentType string
	Asset       domain.Asset
}

// InsertAssetRowTx —— 在 caller 给的 tx 里 insert assets 行（不动 MinIO）。
// 预生成 uuid + storage_key，让 post body_md rewrite 立刻能拿到真 id。
// 返回 PreparedAsset 让 caller 在 tx commit 之后调 UploadBlobs 把 bytes 真
// 推到 MinIO。in.PendingID 透传到返回值方便 caller 一次性 build rewrite map。
func InsertAssetRowTx(
	ctx context.Context, deps AssetsDeps, tx postgres.DBTX,
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

// UploadBlobs —— tx commit 之后 caller 调用，把 prepared bytes 顺次 PUT
// 到 MinIO。任一失败立刻返 error 让 caller 跑 compensating delete；返
// 已成功的 storage_key 列表让 caller 把那部分 blob 也清掉。
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

// DeleteBlobs —— 反向 cleanup。compensating delete 后清掉那部分已上传 blob。
// 失败 swallow + 继续（best-effort，rare double-fault 情形）。
func DeleteBlobs(ctx context.Context, deps AssetsDeps, keys []string) {
	for _, k := range keys {
		if err := deps.Storage.Delete(ctx, k); err != nil {
			_ = err
		}
	}
}

// DeleteBlobsStrict —— DELETE 路径用。任一删失败立刻返 error，DB tx 不
// 启动。invariant: blob 删完才动 DB 行，避免 DB 已删 / blob 残留的 silent
// orphan。MinIO 的 RemoveObject 幂等（S3 spec 204 even for non-existent），
// owner retry 安全。
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
