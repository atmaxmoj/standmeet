// favicon.go — the owner's chosen favicon, a reference to an asset in the global pool. Stored as an
// asset_id; the /favicon.ico route (composition root) memory-caches the bytes and reloads them when
// this id changes. See db/migrations/2026-09-07-owner-favicon.sql.

package usecase

import "context"

// FaviconStore — owner favicon storage (implemented by Repo).
type FaviconStore interface {
	SetFavicon(ctx context.Context, ownerID, assetID string) error
}

// SetOwnerFavicon — point the owner's favicon at a pool asset (” clears it, falling back to the
// product default). No existence/type check: the picker only offers the owner's own image assets,
// and a stale/missing id just falls back to the default (never a crash), so a check would only
// add a cross-module read for no safety gain.
func SetOwnerFavicon(ctx context.Context, store FaviconStore, ownerID, assetID string) error {
	if err := store.SetFavicon(ctx, ownerID, assetID); err != nil {
		return err //nolint:wrapcheck // store already wraps
	}
	return nil
}
