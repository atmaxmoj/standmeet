// asset_refs.go — utilities for the `standmeet-asset:<uuid>` URI scheme embedded in body_md.
//
// Design intent: the markdown body never stores a presigned URL (it would expire via TTL); it
// stores a stable URI instead, resolved to a presigned URL at API response time. That way owner
// edits and re-saves never break a link.
//
// Reference integrity does not rely on scanning: every asset row hangs off some holder via
// holder_id, and the holder's CRUD usecase maintains the assets row + storage blob in the same
// transaction. So this file **only** exposes pure string helpers — "parse the URI" / "extract the
// ID" — the scan/GC/orphan concept is deprecated.

package usecase

import (
	"context"
	"fmt"
	"regexp"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
)

// AssetURIScheme — the stable reference prefix used inside a markdown body.
const AssetURIScheme = "standmeet-asset:"

// assetURIPattern — matches either an already-persisted asset (real UUID v4) or a pending-
// placeholder (used by the frontend during multipart save).
var assetURIPattern = regexp.MustCompile(
	`standmeet-asset:(` +
		`pending-[0-9a-zA-Z_-]+|` +
		`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}` +
		`-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` +
		`)`,
)

// ScanAssetReferences — extracts every referenced asset ID / pending-id from body_md
// (deduplicated, first occurrence wins).
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

// WritingAssetIDs — every asset reference in one writing: the standmeet-asset URIs in body_md
// plus cover_image_asset_id (if set). Used by the route layer for batch resolve.
func WritingAssetIDs(bodyMD string, coverImageAssetID *string) []string {
	ids := ScanAssetReferences(bodyMD)
	if coverImageAssetID != nil && *coverImageAssetID != "" {
		ids = append(ids, *coverImageAssetID)
	}
	return ids
}

// ResolveAssetURLs — issues presigned URLs in batch for a set of real asset IDs. pending-*
// placeholders never appear here (the caller has already rewritten them). A missing ID is
// skipped best-effort.
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
