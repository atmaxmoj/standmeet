// boot_wireup_microsites.go —— assembly for the public-side **microsites** family.
//
// Split out of boot_wireup.go: that file was at its 350-line cap, and these two are
// two faces of the same thing — `/p/{slug}` serves the live build, preview serves the
// most recent successful one, token-gated. Kept together so a change to one stays
// visible next to the other.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
)

func buildPublicMicrositeDeps(d *deps.Runtime) publicroutes.MicrositeHandlers {
	return publicroutes.MicrositeHandlers{
		Deps:       owner.MicrositeDeps{Pages: d.MicrositeRepo, Builds: d.MicrositeBuildRepo},
		Owners:     d.OwnerRepo,
		Log:        d.Log,
		BuildsRoot: d.BuildsRoot,
	}
}

// buildPublicMicrositeStoreDeps — the visitor store route (GET/POST /pages/{slug}/store). The face
// never touches the domain (check-routes-via-dispatcher); the closures here close over the store
// usecase and translate its sentinel errors into display errors before the face ever sees them.
func buildPublicMicrositeStoreDeps(d *deps.Runtime) publicroutes.MicrositeStoreHandlers {
	pageDeps := owner.MicrositeDeps{
		Pages: d.MicrositeRepo, Builds: d.MicrositeBuildRepo, Docs: d.MicrositeDocs,
	}
	return publicroutes.MicrositeStoreHandlers{
		Log: d.Log,
		Insert: func(
			ctx context.Context, slug, collection string, doc json.RawMessage,
		) (string, error) {
			w := owner.DocWrite{Slug: slug, Collection: collection, Doc: doc}
			id, err := owner.PublicInsertMicrositeDoc(ctx, pageDeps, d.OwnerRepo, w)
			return id, mapMicrositeStoreErr(err)
		},
		Query: func(
			ctx context.Context, slug, collection string, filter json.RawMessage,
		) ([]json.RawMessage, error) {
			q := owner.DocQuery{Slug: slug, Collection: collection, Filter: filter}
			docs, err := owner.PublicQueryMicrositeDocs(ctx, pageDeps, d.OwnerRepo, q)
			return docs, mapMicrositeStoreErr(err)
		},
	}
}

// micrositeStoreDisplay — how each store sentinel is shown to a visitor. First match wins.
var micrositeStoreDisplay = []struct {
	match         error
	code, message string
	status        int
}{
	{
		owner.ErrMicrositeStoreNotWritable, "store_closed",
		"this page is not accepting submissions", http.StatusForbidden,
	},
	{
		owner.ErrMicrositeStoreQuota, "store_full",
		"this page's store is full", http.StatusTooManyRequests,
	},
	{owner.ErrMicrositeStoreInvalid, "bad_request", "invalid submission", http.StatusBadRequest},
	{owner.ErrMicrositeNotFound, "not_found", "no such page", http.StatusNotFound},
}

// mapMicrositeStoreErr — translate the store usecase's sentinels into display errors (composition
// root is allowed to know the domain; the face is not). nil and unknown errors pass through.
func mapMicrositeStoreErr(err error) error {
	if err == nil {
		return nil
	}
	for _, d := range micrositeStoreDisplay {
		if errors.Is(err, d.match) {
			return apierr.DisplayWrap(d.status, d.code, d.message, err)
		}
	}
	return err
}

func buildPublicMicrositePreviewDeps(d *deps.Runtime) publicroutes.MicrositePreviewHandlers {
	pageDeps := owner.MicrositeDeps{Pages: d.MicrositeRepo, Builds: d.MicrositeBuildRepo}
	return publicroutes.MicrositePreviewHandlers{
		Log:        d.Log,
		BuildsRoot: d.BuildsRoot,
		// The two closures close over the domain right here: the face layer only
		// receives the answer, it never gets to know the domain (see
		// check-routes-via-dispatcher — a face reaching the domain directly is
		// bypassing the outbound convergence point).
		VerifyToken: func(slug, token string) (string, error) {
			return owner.VerifyPreviewToken(d.SessionKey, slug, token, time.Now())
		},
		ResolveBuild: func(
			ctx context.Context, ownerID, slug string,
		) (publicroutes.BuiltAsset, error) {
			page, err := owner.ResolvePreviewBuild(ctx, pageDeps, ownerID, slug)
			if err != nil {
				return publicroutes.BuiltAsset{}, fmt.Errorf("resolve preview build: %w", err)
			}
			return publicroutes.BuiltAsset{
				PageID: page.Build.PageID, BuildID: page.Build.ID,
				AllowBYOAI: page.AllowBYOAI,
			}, nil
		},
	}
}
