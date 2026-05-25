// asset_refs.go —— body_md 里的 `standmeet-asset:<uuid>` URI scheme 工具。
//
// 设计目的：markdown body 不存 presigned URL (会 TTL 失效)，存 stable
// URI；API response 时 resolve 成 presigned。这样 owner 编辑、AI 写、re-save
// 都不破。
//
// orphan 追踪靠这个 scheme：scan body_md → extract ID 集合 → diff assets
// 表 → 没人引的 = orphan。
//
// AssetURIScheme 应用范围：post body_md（v1）；wiki/output body 后续扩。

package usecases

import (
	"context"
	"fmt"
	"regexp"

	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/storage"
)

// AssetURIScheme —— markdown body 里的 stable 引用。
const AssetURIScheme = "standmeet-asset:"

// assetURIPattern —— `standmeet-asset:<uuid>` 的捕获 regex。UUID v4 长度
// 36 (8-4-4-4-12 hex with dashes)。
var assetURIPattern = regexp.MustCompile(
	`standmeet-asset:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`,
)

// ScanAssetReferences —— 从 body_md 抽出所有引用的 asset ID（去重）。
// 顺序：首次出现先。
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

// ResolveAssetURLs —— 给一组 asset ID 批量颁发 presigned URL。返回 map
// 缺 ID = storage 那条出问题（log 不阻断）。
//
// caller 是 post API：拿到 body_md → ScanAssetReferences → ResolveAssetURLs
// → 把 map 塞进 response 让前端 renderer 替换 src。
func ResolveAssetURLs(
	ctx context.Context, repo *postgres.AssetRepo, store *storage.Client,
	ids []string,
) (map[string]string, error) {
	if len(ids) == 0 {
		return map[string]string{}, nil
	}
	out := make(map[string]string, len(ids))
	for _, id := range ids {
		url, err := resolveOne(ctx, repo, store, id)
		if err != nil {
			continue // 缺 ID 前端有降级
		}
		out[id] = url
	}
	return out, nil
}

func resolveOne(
	ctx context.Context, repo *postgres.AssetRepo, store *storage.Client, id string,
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

// FindOrphanAssets —— 列出 owner 名下 assets 表里**没被任何 post 引用**的 asset。
// 当前扫 post.body_md；后续扩 wiki / output / custom_page 时往这里加 source。
// 设计：只读，不删；删动作走 admin GC endpoint 或 MCP tool 主动触发。
func FindOrphanAssets(
	ctx context.Context, assetsRepo *postgres.AssetRepo,
	postsRepo *postgres.PostRepo, ownerID string,
) ([]string, error) {
	referenced, err := collectReferencedAssetIDs(ctx, postsRepo, ownerID)
	if err != nil {
		return nil, fmt.Errorf("collect references: %w", err)
	}
	// limit=0 → sqlc query 通过 NULLIF 把 0 当 "no limit"，全拉。
	assets, err := assetsRepo.ListByOwner(ctx, ownerID, 0)
	if err != nil {
		return nil, fmt.Errorf("list assets: %w", err)
	}
	orphans := make([]string, 0)
	for i := range assets {
		if _, used := referenced[assets[i].ID]; !used {
			orphans = append(orphans, assets[i].ID)
		}
	}
	return orphans, nil
}

func collectReferencedAssetIDs(
	ctx context.Context, postsRepo *postgres.PostRepo, ownerID string,
) (map[string]struct{}, error) {
	posts, err := postsRepo.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list posts: %w", err)
	}
	out := make(map[string]struct{})
	for i := range posts {
		for _, id := range ScanAssetReferences(posts[i].BodyMD) {
			out[id] = struct{}{}
		}
	}
	return out, nil
}
