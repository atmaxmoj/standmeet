// asset_refs.go — utilities for the `standmeet-asset:<uuid>` URI scheme embedded in body_md.
//
// Design intent: the markdown body never stores a presigned URL (it would expire via TTL); it
// stores a stable URI instead, resolved to a presigned URL at API response time. That way owner
// edits and re-saves never break a link.
//
// Reference integrity is now content-derived (docs/design/global-assets.md): a note references
// exactly the pool assets its content cites, recomputed from the body + cover on every save
// (see note_asset_refs.go). This file exposes the scan — "extract every standmeet-asset id from a
// body" — that the recompute and the URL-resolve paths both build on.

package usecase

import (
	"context"
	"fmt"
	"regexp"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
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

// ResolveAssetURLs — resolves a set of real asset IDs to their stable serve paths (the backend's
// thin /api/v1/assets/{id} route). pending-* placeholders never appear here (the caller has already
// rewritten them). A missing ID is skipped best-effort.
func ResolveAssetURLs(
	ctx context.Context, repo *repo.AssetRepo,
	ids []string,
) (map[string]string, error) {
	if len(ids) == 0 {
		return map[string]string{}, nil
	}
	out := make(map[string]string, len(ids))
	for _, id := range ids {
		url, err := resolveOne(ctx, repo, id)
		if err != nil {
			continue
		}
		out[id] = url
	}
	return out, nil
}

// resolveOne — the asset's stable serve path, once its existence is confirmed. Missing → skipped.
func resolveOne(ctx context.Context, repo *repo.AssetRepo, id string) (string, error) {
	if _, err := repo.GetByID(ctx, id); err != nil {
		return "", fmt.Errorf("get asset %s: %w", id, err)
	}
	return assetPublicPath(id), nil
}

// assetPublicPath — the backend's thin serve route for an asset (GET /api/v1/assets/{id}). The body
// stores the stable standmeet-asset:<id> URI; this resolves it to the route the browser fetches,
// which streams the bytes from object storage over the internal network — never a presigned minio
// link, so minio is never exposed.
func assetPublicPath(id string) string {
	return "/api/v1/assets/" + id
}
