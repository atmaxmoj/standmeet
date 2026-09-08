// boot_favicon.go — serves /favicon.ico from an in-memory copy of the owner's chosen asset.
//
// The bytes (the storage fetch) are cached; each request only does a cheap read of the owner's
// favicon_asset_id and reloads the bytes when that id changed. So both surfaces that set it — the
// admin picker and the MCP op — take effect on the next request with no cross-module callback. An
// empty id (or a load error) falls back to the embedded default, so the route always returns
// something. Warmed once at boot so the first request is already hot.

package main

import (
	"context"
	_ "embed"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
)

// mountFavicon —— GET /favicon.ico, served from the in-memory cache (the app rewrites /favicon.ico
// here). The handler is assembled in buildServerDeps; nil in tests that don't wire it, then the
// route is simply not mounted.
func mountFavicon(r chi.Router, sd *Deps) {
	if sd.FaviconHandler != nil {
		r.Get("/favicon.ico", sd.FaviconHandler)
	}
}

// defaultFavicon — the product default, served whenever the owner hasn't picked one (or their pick
// fails to load). Without it the /favicon.ico rewrite would shadow the app's own icon and leave a
// blank tab.
//
//go:embed default_favicon.ico
var defaultFavicon []byte

const defaultFaviconCT = "image/x-icon"

// faviconBlob — a served favicon: MIME type + bytes. Bundled so reload/current return one value.
type faviconBlob struct {
	contentType string
	bytes       []byte
}

type faviconCache struct {
	log         *slog.Logger
	soleFavicon func(context.Context) (string, error)
	assetMeta   func(context.Context, string) (storageKey, contentType string, err error)
	fetchBytes  func(context.Context, string) ([]byte, error)

	assetID string
	blob    faviconBlob
	mu      sync.RWMutex
}

// reload — fetch the asset's bytes for `id` and replace the cache.
func (c *faviconCache) reload(ctx context.Context, id string) (faviconBlob, error) {
	key, ct, err := c.assetMeta(ctx, id)
	if err != nil {
		return faviconBlob{}, err
	}
	b, err := c.fetchBytes(ctx, key)
	if err != nil {
		return faviconBlob{}, err
	}
	blob := faviconBlob{bytes: b, contentType: ct}
	c.mu.Lock()
	c.assetID, c.blob = id, blob
	c.mu.Unlock()
	return blob, nil
}

// current — the cached blob for `id`, reloading if the id moved or nothing is cached yet.
func (c *faviconCache) current(ctx context.Context, id string) (faviconBlob, bool) {
	c.mu.RLock()
	cached, blob := c.assetID, c.blob
	c.mu.RUnlock()
	if id == cached && blob.bytes != nil {
		return blob, true
	}
	blob, err := c.reload(ctx, id)
	if err != nil {
		c.log.Warn("favicon reload failed", "err", err)
		return faviconBlob{}, false
	}
	return blob, true
}

// pick — the owner's custom favicon if set and loadable, else the embedded default (never a 404).
func (c *faviconCache) pick(ctx context.Context) faviconBlob {
	id, err := c.soleFavicon(ctx)
	if err != nil || id == "" {
		return faviconBlob{bytes: defaultFavicon, contentType: defaultFaviconCT}
	}
	blob, ok := c.current(ctx, id)
	if !ok {
		return faviconBlob{bytes: defaultFavicon, contentType: defaultFaviconCT}
	}
	return blob
}

func (c *faviconCache) serve() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		blob := c.pick(r.Context())
		w.Header().Set("Content-Type", blob.contentType)
		w.Header().Set("Cache-Control", "public, max-age=300")
		if _, werr := w.Write(blob.bytes); werr != nil {
			c.log.Warn("write favicon", "err", werr)
		}
	}
}

// buildFaviconHandler — assemble the /favicon.ico handler from the runtime's owner + asset repos +
// storage. The cache loads lazily on the first request (and reloads when the id changes), so no
// boot-time context is needed. In the composition root so boot_favicon stays domain-free.
func buildFaviconHandler(d *deps.Runtime) http.HandlerFunc {
	cache := &faviconCache{
		log:         d.Log,
		soleFavicon: d.OwnerRepo.SoleFavicon,
		assetMeta: func(ctx context.Context, id string) (string, string, error) {
			a, err := d.AssetRepo.GetByID(ctx, id)
			if err != nil {
				return "", "", fmt.Errorf("get favicon asset: %w", err)
			}
			return a.StorageKey, a.ContentType, nil
		},
		fetchBytes: d.StorageClient.Get,
	}
	return cache.serve()
}
