// custom_page_resolve.go — used by routes/public/custom_pages.go: centralizes the
// multi-step sole-owner→page→live_build chain in the usecase layer so the handler
// stays at cyclo <= 3.

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// SoleOwnerLookup — used by ResolveLiveBuild to fetch the sole owner (v1 single-owner
// instance). Lets the routes layer avoid depending on postgres directly.
type SoleOwnerLookup interface {
	FirstHandle(ctx context.Context) (string, error)
	GetByHandle(ctx context.Context, handle string) (entity.Owner, error)
}

// ResolveLiveBuild — returns the live build for the given slug on the sole owner's
// public page + that page's settings.
func ResolveLiveBuild(
	ctx context.Context, deps CustomPageDeps, owners SoleOwnerLookup, slug string,
) (LivePage, error) {
	handle, herr := owners.FirstHandle(ctx)
	if herr != nil {
		return LivePage{}, fmt.Errorf("first owner handle: %w", herr)
	}
	if handle == "" {
		return LivePage{}, entity.ErrOwnerNotFound
	}
	soleOwner, oerr := owners.GetByHandle(ctx, handle)
	if oerr != nil {
		if errors.Is(oerr, entity.ErrOwnerNotFound) {
			return LivePage{}, entity.ErrOwnerNotFound
		}
		return LivePage{}, fmt.Errorf("get sole owner: %w", oerr)
	}
	return resolveByOwner(ctx, deps, soleOwner.ID, slug)
}

// LivePage — the page currently being served: which build's artifacts, plus that page's
// own settings **at this instant**. The two are returned together because the two
// decisions involved in serving a request (which files to read, whether this page allows
// bring-your-own-key) both come from the same row — querying them separately could give
// answers from two different moments.
type LivePage struct {
	Build      entity.CustomPageBuild
	AllowBYOAI bool
}

func resolveByOwner(
	ctx context.Context, deps CustomPageDeps, ownerID, slug string,
) (LivePage, error) {
	page, perr := deps.Pages.GetBySlug(ctx, ownerID, slug)
	if perr != nil {
		return LivePage{}, fmt.Errorf("get page: %w", perr)
	}
	if page.LiveBuildID == nil {
		return LivePage{}, entity.ErrCustomPageNotFound
	}
	build, berr := deps.Builds.GetByID(ctx, *page.LiveBuildID)
	if berr != nil {
		return LivePage{}, fmt.Errorf("get build: %w", berr)
	}
	return LivePage{Build: build, AllowBYOAI: page.AllowBYOAI}, nil
}

// ResolvePreviewBuild — the version used **for owner preview**: this page's most
// recently successful build.
//
// Why this needs its own function: `/p/{slug}` serves live (resolveByOwner reads
// LiveBuildID), so between the agent finishing a build and the owner giving the go-ahead,
// the owner has **no way to see that version anywhere** — and that's exactly the version
// he wants to see (he decides whether to publish after looking at it).
//
// **One rule, no fallback chain**: the most recently successful build, period.
//   - Does not look at staging_build_id: that would require the agent to remember an
//     extra promote_to_staging call, and if it forgets, the owner sees nothing and has
//     no idea why. What the owner wants is "see what it just did".
//   - Only looks at built: pending / building / failed have no artifact, so rendering
//     them yields a blank page, and the owner would think the page he wrote is broken.
//     The most recently **successful** build is still what he saw last time, and a
//     build failure should be communicated by the build-status row, not by making the
//     preview go blank.
func ResolvePreviewBuild(
	ctx context.Context, deps CustomPageDeps, ownerID, slug string,
) (LivePage, error) {
	page, perr := deps.Pages.GetBySlug(ctx, ownerID, slug)
	if perr != nil {
		return LivePage{}, fmt.Errorf("get page: %w", perr)
	}
	build, berr := deps.Builds.GetLatestBuiltForPage(ctx, page.ID)
	if berr != nil {
		return LivePage{}, fmt.Errorf("latest built build: %w", berr)
	}
	return LivePage{Build: build, AllowBYOAI: page.AllowBYOAI}, nil
}
