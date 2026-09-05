// boot_wireup_pages.go —— assembly for the public-side **custom pages** family.
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

func buildPublicCustomPageDeps(d *deps.Runtime) publicroutes.CustomPageHandlers {
	return publicroutes.CustomPageHandlers{
		Deps:       owner.CustomPageDeps{Pages: d.CustomPageRepo, Builds: d.CustomBuildRepo},
		Owners:     d.OwnerRepo,
		Log:        d.Log,
		BuildsRoot: d.BuildsRoot,
	}
}

// buildPublicPageStoreDeps — the visitor page-store route (GET/POST /pages/{slug}/store). The face
// never touches the domain (check-routes-via-dispatcher); the closures here close over the store
// usecase and translate its sentinel errors into display errors before the face ever sees them.
func buildPublicPageStoreDeps(d *deps.Runtime) publicroutes.PageStoreHandlers {
	pageDeps := owner.CustomPageDeps{
		Pages: d.CustomPageRepo, Builds: d.CustomBuildRepo, Docs: d.PageDocs,
	}
	return publicroutes.PageStoreHandlers{
		Log: d.Log,
		Insert: func(
			ctx context.Context, slug, collection string, doc json.RawMessage,
		) (string, error) {
			w := owner.DocWrite{Slug: slug, Collection: collection, Doc: doc}
			id, err := owner.PublicInsertPageDoc(ctx, pageDeps, d.OwnerRepo, w)
			return id, mapPageStoreErr(err)
		},
		Query: func(
			ctx context.Context, slug, collection string, filter json.RawMessage,
		) ([]json.RawMessage, error) {
			q := owner.DocQuery{Slug: slug, Collection: collection, Filter: filter}
			docs, err := owner.PublicQueryPageDocs(ctx, pageDeps, d.OwnerRepo, q)
			return docs, mapPageStoreErr(err)
		},
	}
}

// pageStoreDisplay — how each store sentinel is shown to a visitor. First match wins.
var pageStoreDisplay = []struct {
	match         error
	code, message string
	status        int
}{
	{
		owner.ErrPageStoreNotWritable, "store_closed",
		"this page is not accepting submissions", http.StatusForbidden,
	},
	{
		owner.ErrPageStoreQuota, "store_full",
		"this page's store is full", http.StatusTooManyRequests,
	},
	{owner.ErrPageStoreInvalid, "bad_request", "invalid submission", http.StatusBadRequest},
}

// mapPageStoreErr — translate the store usecase's sentinels into display errors (the composition
// root is allowed to know the domain; the face is not). nil and unknown errors pass through.
func mapPageStoreErr(err error) error {
	if err == nil {
		return nil
	}
	for _, d := range pageStoreDisplay {
		if errors.Is(err, d.match) {
			return apierr.DisplayWrap(d.status, d.code, d.message, err)
		}
	}
	return err
}

func buildPublicCustomPagePreviewDeps(d *deps.Runtime) publicroutes.CustomPagePreviewHandlers {
	pageDeps := owner.CustomPageDeps{Pages: d.CustomPageRepo, Builds: d.CustomBuildRepo}
	return publicroutes.CustomPagePreviewHandlers{
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
