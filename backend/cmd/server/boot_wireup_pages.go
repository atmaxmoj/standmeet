// boot_wireup_pages.go —— assembly for the public-side **custom pages** family.
//
// Split out of boot_wireup.go: that file was at its 350-line cap, and these two are
// two faces of the same thing — `/p/{slug}` serves the live build, preview serves the
// most recent successful one, token-gated. Kept together so a change to one stays
// visible next to the other.

package main

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
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
