// microsite_resolve.go — used by routes/public/microsites.go: centralizes the
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
	ctx context.Context, deps MicrositeDeps, owners SoleOwnerLookup, slug string,
) (LivePage, error) {
	soleOwner, err := resolveSoleOwner(ctx, owners)
	if err != nil {
		return LivePage{}, err
	}
	return resolveByOwner(ctx, deps, soleOwner.ID, slug)
}

// ResolveOpenBuild —— ResolveLiveBuild for a visitor: a page closed to visitors without a code
// resolves only when granted(pageID) says the request carries a grant; else ErrMicrositeNeedsCode.
func ResolveOpenBuild(
	ctx context.Context, deps MicrositeDeps, owners SoleOwnerLookup, slug string,
	granted func(pageID string) bool,
) (LivePage, error) {
	live, err := ResolveLiveBuild(ctx, deps, owners, slug)
	if err != nil {
		return LivePage{}, err
	}
	if !live.OpenWithoutCode && !granted(live.Build.PageID) {
		return LivePage{}, entity.ErrMicrositeNeedsCode
	}
	return live, nil
}

// resolveSoleOwner — the v1 single-owner instance's owner, resolved through the same
// handle chain used across public routes. Shared by ResolveLiveBuild and LiveMicrosites.
func resolveSoleOwner(ctx context.Context, owners SoleOwnerLookup) (entity.Owner, error) {
	handle, herr := owners.FirstHandle(ctx)
	if herr != nil {
		return entity.Owner{}, fmt.Errorf("first owner handle: %w", herr)
	}
	if handle == "" {
		return entity.Owner{}, entity.ErrOwnerNotFound
	}
	soleOwner, oerr := owners.GetByHandle(ctx, handle)
	if oerr != nil {
		if errors.Is(oerr, entity.ErrOwnerNotFound) {
			return entity.Owner{}, entity.ErrOwnerNotFound
		}
		return entity.Owner{}, fmt.Errorf("get sole owner: %w", oerr)
	}
	return soleOwner, nil
}

// LivePageLink — a published microsite as a visitor discovers it: slug + title, nothing
// more. The public listing carries no build ids, no drafts, no taken-down pages, no bound
// codes — only what a link needs.
type LivePageLink struct {
	Slug  string
	Title string
}

// LiveMicrosites — the sole owner's published (has-live) microsites, for public
// discovery on the index / gate / reader. A page appears only once it has a live build; a
// draft or a taken-down page never leaks here. Order follows the repo (newest first).
func LiveMicrosites(
	ctx context.Context, deps MicrositeDeps, owners SoleOwnerLookup,
) ([]LivePageLink, error) {
	soleOwner, err := resolveSoleOwner(ctx, owners)
	if err != nil {
		return []LivePageLink{}, err
	}
	pages, lerr := deps.Pages.ListByOwner(ctx, soleOwner.ID)
	if lerr != nil {
		return []LivePageLink{}, fmt.Errorf("list microsites: %w", lerr)
	}
	return advertised(pages), nil
}

// advertised —— the live pages a visitor without a code may open; a closed page is not
// advertised to them either.
func advertised(pages []entity.Microsite) []LivePageLink {
	out := make([]LivePageLink, 0, len(pages))
	for i := range pages {
		open := pages[i].Access != nil && pages[i].Access.OpenWithoutCode
		if pages[i].LiveBuildID != nil && open {
			out = append(out, LivePageLink{Slug: pages[i].Slug, Title: pages[i].Title})
		}
	}
	return out
}

// LivePage — the page currently being served: which build's artifacts, plus that page's
// own settings **at this instant**. The two are returned together because the two
// decisions involved in serving a request (which files to read, whether this page allows
// bring-your-own-key) both come from the same row — querying them separately could give
// answers from two different moments.
type LivePage struct {
	SeoTitle       *string
	SeoDescription *string
	SeoImage       *string
	Build          entity.MicrositeBuild
	AllowBYOAI     bool
	// OpenWithoutCode —— may a visitor with no code read this page (see
	// microsite_opens_without_code). Filled for the live page; the owner's preview doesn't ask.
	OpenWithoutCode bool
}

func resolveByOwner(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string,
) (LivePage, error) {
	page, perr := deps.Pages.GetBySlug(ctx, ownerID, slug)
	if perr != nil {
		return LivePage{}, fmt.Errorf("get page: %w", perr)
	}
	if page.LiveBuildID == nil {
		return LivePage{}, entity.ErrMicrositeNotFound
	}
	build, berr := deps.Builds.GetByID(ctx, *page.LiveBuildID)
	if berr != nil {
		return LivePage{}, fmt.Errorf("get build: %w", berr)
	}
	open, oerr := deps.Pages.OpensWithoutCode(ctx, page.ID)
	if oerr != nil {
		return LivePage{}, fmt.Errorf("opens without code: %w", oerr)
	}
	return LivePage{
		Build: build, AllowBYOAI: page.AllowBYOAI, OpenWithoutCode: open,
		SeoTitle: page.SeoTitle, SeoDescription: page.SeoDescription, SeoImage: page.SeoImage,
	}, nil
}

// SetPageOpenWithoutCode —— the owner's "open without an access code" switch for one page.
func SetPageOpenWithoutCode(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string, open bool,
) error {
	if err := deps.Pages.SetOpenWithoutCode(ctx, ownerID, slug, open); err != nil {
		return fmt.Errorf("set open without code: %w", err)
	}
	return nil
}

// CodeOpensPage —— does this code (a visitor session's) open this page: an active code bound to it.
func CodeOpensPage(ctx context.Context, deps MicrositeDeps, codeID, pageID string) (bool, error) {
	ok, err := deps.Pages.CodeOpens(ctx, codeID, pageID)
	if err != nil {
		return false, fmt.Errorf("code opens page: %w", err)
	}
	return ok, nil
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
	ctx context.Context, deps MicrositeDeps, ownerID, slug string,
) (LivePage, error) {
	page, perr := deps.Pages.GetBySlug(ctx, ownerID, slug)
	if perr != nil {
		return LivePage{}, fmt.Errorf("get page: %w", perr)
	}
	build, berr := deps.Builds.GetLatestBuiltForPage(ctx, page.ID)
	if berr != nil {
		return LivePage{}, fmt.Errorf("latest built build: %w", berr)
	}
	return LivePage{
		Build: build, AllowBYOAI: page.AllowBYOAI,
		SeoTitle: page.SeoTitle, SeoDescription: page.SeoDescription, SeoImage: page.SeoImage,
	}, nil
}
