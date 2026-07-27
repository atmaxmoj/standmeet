// asset_refs.go —— body_md 里的 `standmeet-asset:<uuid>` URI scheme 工具。
//
// 设计目的：markdown body 不存 presigned URL (会 TTL 失效)，存 stable
// URI；API response 时 resolve 成 presigned。这样 owner 编辑、re-save 都不破。
//
// 引用完整性不靠 scan：每张 asset 行通过 holder_id 挂在某个 holder 上，
// holder CRUD usecase 同事务维护 assets 行 + storage blob。所以这里**只**
// 暴露 "解 URI" / "提 ID" 这种纯字符串 helper —— scan/GC/orphan 的概念
// 已经废弃。

package usecase

import (
	"context"
	"fmt"
	"regexp"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
)

// AssetURIScheme —— markdown body 里的 stable 引用前缀。
const AssetURIScheme = "standmeet-asset:"

// assetURIPattern —— 命中已落库的 asset (真 UUID v4) 或 pending- 占位
// (multipart save 时前端用)。
var assetURIPattern = regexp.MustCompile(
	`standmeet-asset:(` +
		`pending-[0-9a-zA-Z_-]+|` +
		`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}` +
		`-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` +
		`)`,
)

// ScanAssetReferences —— 从 body_md 抽出所有引用的 asset ID / pending-id
// (去重，首次出现先)。
func ScanAssetReferences(bodyMD string) []string {
	matches := assetURIPattern.FindAllStringSubmatch(bodyMD, -1)
	seen := make(map[string]struct{}, len(matches))
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		id := m[1]
		if _, dup := seen[id]; !dup {
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	return out
}

// WritingAssetIDs —— 一篇 writing 里所有 asset 引用：body_md 里的
// standmeet-asset URI + cover_image_asset_id（如果设了）。route layer batch
// resolve 用。
func WritingAssetIDs(bodyMD string, coverImageAssetID *string) []string {
	ids := ScanAssetReferences(bodyMD)
	if coverImageAssetID != nil && *coverImageAssetID != "" {
		ids = append(ids, *coverImageAssetID)
	}
	return ids
}

// ResolveAssetURLs —— 给一组真 asset ID 批量颁发 presigned URL。pending-*
// 占位不会出现在这里（caller 已经 rewrite 完）。缺 ID 用 best-effort 跳过。
func ResolveAssetURLs(
	ctx context.Context, repo *repo.AssetRepo, store *storage.Client,
	ids []string,
) (map[string]string, error) {
	if len(ids) == 0 {
		return map[string]string{}, nil
	}
	out := make(map[string]string, len(ids))
	for _, id := range ids {
		url, err := resolveOne(ctx, repo, store, id)
		if err != nil {
			continue
		}
		out[id] = url
	}
	return out, nil
}

func resolveOne(
	ctx context.Context, repo *repo.AssetRepo, store *storage.Client, id string,
) (string, error) {
	asset, err := repo.GetByID(ctx, id)
	if err != nil {
		return "", fmt.Errorf("get asset %s: %w", id, err)
	}
	url, perr := store.PresignedGetURL(ctx, asset.StorageKey)
	if perr != nil {
		return "", fmt.Errorf("presign %s: %w", id, perr)
	}
	return url, nil
}
