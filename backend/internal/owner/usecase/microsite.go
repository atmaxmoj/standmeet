// microsite.go — the full microsites usecase set.
// Flow: CreatePage(slug) -> WriteFile accumulates source_files -> Build persists a pending
// build for the builder service -> GetBuild lets owner/MCP poll status -> PromoteToStaging /
// PromoteToLive -> Rollback / Delete.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"maps"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// MicrositeDeps — microsite usecase dependencies.
type MicrositeDeps struct {
	Pages  *repo.MicrositeRepo
	Builds *repo.MicrositeBuildRepo
	// HomepageSEO — where the reserved home slug's SEO is written (the owner, not a microsite row).
	// Wired only where set_seo can be invoked for the homepage (the dispatcher); nil elsewhere.
	HomepageSEO HomepageSEOStore
	// Docs — the page's own document store (per-page schema). Set on admin paths (create provisions
	// it, delete drops it, the store ops read/write it); nil on paths that never touch it (e.g.
	// public serving), where the lifecycle hooks and store ops are skipped.
	Docs MicrositeDocStore
	// PreviewSigningKey — signs the admin preview URL (HMAC-derived, never persisted). Empty:
	// no preview URL, but the list still works.
	PreviewSigningKey string
}

// HomepageSlug — the reserved microsite slug served at the site root `/`. One per instance
// (v1 single-owner). The page promoted to live under this slug IS the homepage. Lives in the
// domain so both the public route (routes/public) and the claim-time seed can reference it.
const HomepageSlug = "home"

// CreatePageInput — input to create a microsite.
type CreatePageInput struct {
	OwnerID string
	Slug    string
	Title   string
}

// CreatePage — slug must be a-z0-9-, length <= 64. The reserved home slug is a SINGLETON:
// get-or-restore it (never a second row; a soft-deleted one is un-deleted) rather than a plain
// insert the one-home-per-owner index would reject. Every create path (MCP, claim-time seed) goes
// through here, so the singleton invariant has one gate.
func CreatePage(
	ctx context.Context, deps MicrositeDeps, in *CreatePageInput,
) (entity.Microsite, error) {
	if err := validateSlug(in.Slug); err != nil {
		return entity.Microsite{}, err
	}
	if in.Slug == HomepageSlug {
		return EnsureHomepage(ctx, deps.Pages, in.OwnerID)
	}
	page, err := deps.Pages.Create(ctx, in.OwnerID, in.Slug, in.Title)
	if err != nil {
		return entity.Microsite{}, fmt.Errorf("create page: %w", err)
	}
	// The page's document schema is provisioned lazily on the first write (VisitorInsert), so
	// creation stays independent of the store — and existing pages need no backfill.
	return page, nil
}

// RenamePage — change a microsite's slug (its /p/<slug> address). The new slug must be valid and
// free (a-z0-9-, ≤64); the reserved home slug can be neither source nor target (it is pinned to
// `/`). Access codes bind by microsite id, so their bindings follow the rename automatically.
func RenamePage(
	ctx context.Context, deps MicrositeDeps, ownerID, oldSlug, newSlug string,
) (entity.Microsite, error) {
	if oldSlug == HomepageSlug || newSlug == HomepageSlug {
		return entity.Microsite{}, entity.ErrMicrositeHomeReserved
	}
	if err := validateSlug(newSlug); err != nil {
		return entity.Microsite{}, err
	}
	page, err := deps.Pages.Rename(ctx, ownerID, oldSlug, newSlug)
	if err != nil {
		return entity.Microsite{}, fmt.Errorf("rename page: %w", err)
	}
	return page, nil
}

// SetPageByoai — whether this page lets a reader use their own key when no grant is presented
// at all. Only takes effect then: a reader arriving with a code has the code decide everything,
// overriding this (I-4) — that rule lives on the composition side (a wiring concern), not here.
// This function only stores the owner's intent.
func SetPageByoai(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string, allow bool,
) (entity.Microsite, error) {
	page, err := deps.Pages.SetByoai(ctx, ownerID, slug, allow)
	if err != nil {
		return entity.Microsite{}, fmt.Errorf("set page byoai: %w", err)
	}
	return page, nil
}

// WriteFileInput — accumulate-write one file into the page's next draft.
type WriteFileInput struct {
	OwnerID string
	Slug    string
	Path    string
	Content string
}

const (
	maxFiles        = 32
	maxFileBytes    = 64 * 1024
	maxTotalBytes   = 512 * 1024
	maxPathLen      = 256
	maxSlugLen      = 64
	maxErrorMessage = 2000
)

// WriteFile — path must not contain '..' / be absolute; content <= 64KB; total <= 512KB. Merges
// the new path/content into the previous build's source_files and persists a new pending build.
func WriteFile(
	ctx context.Context, deps MicrositeDeps, in *WriteFileInput,
) (entity.MicrositeBuild, error) {
	if verr := validatePathContent(in.Path, in.Content); verr != nil {
		return entity.MicrositeBuild{}, verr
	}
	page, lerr := lookupPage(ctx, deps, in.OwnerID, in.Slug)
	if lerr != nil {
		return entity.MicrositeBuild{}, lerr
	}
	files, ferr := mergedDraft(ctx, deps, page.ID, in.Path, in.Content)
	if ferr != nil {
		return entity.MicrositeBuild{}, ferr
	}
	build, berr := deps.Builds.Create(ctx, page.ID, files)
	if berr != nil {
		return entity.MicrositeBuild{}, fmt.Errorf("create build: %w", berr)
	}
	return build, nil
}

// mergedDraft — loads the previous source_files, merges in this write, validates bundle size.
func mergedDraft(
	ctx context.Context, deps MicrositeDeps,
	pageID, path, content string,
) (map[string]string, error) {
	files, err := loadDraftFiles(ctx, deps, pageID)
	if err != nil {
		return nil, err
	}
	files[path] = content
	if verr := validateBundleSize(files); verr != nil {
		return nil, verr
	}
	return files, nil
}

// Build — explicitly triggers a build: turns the latest pending build into something the
// builder can consume. Current implementation just returns the latest pending build (WriteFile
// already wrote one). Returns ErrMicrositeBuildNotFound when there's no pending build.
func Build(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string,
) (entity.MicrositeBuild, error) {
	page, perr := lookupPage(ctx, deps, ownerID, slug)
	if perr != nil {
		return entity.MicrositeBuild{}, perr
	}
	build, berr := deps.Builds.GetLatestForPage(ctx, page.ID)
	if berr != nil {
		return entity.MicrositeBuild{}, fmt.Errorf("get latest build: %w", berr)
	}
	return build, nil
}

// GetBuild — used by MCP to poll status.
func GetBuild(
	ctx context.Context, deps MicrositeDeps, buildID string,
) (entity.MicrositeBuild, error) {
	build, err := deps.Builds.GetByID(ctx, buildID)
	if err != nil {
		return entity.MicrositeBuild{}, fmt.Errorf("get build: %w", err)
	}
	return build, nil
}

// PromoteToStaging — sets build as the page's staging_build_id.
// The build must belong to this page + status must be built.
func PromoteToStaging(
	ctx context.Context, deps MicrositeDeps, ownerID, slug, buildID string,
) (entity.Microsite, error) {
	page, err := promoteCheck(ctx, deps, ownerID, slug, buildID)
	if err != nil {
		return entity.Microsite{}, err
	}
	updated, perr := deps.Pages.SetStaging(ctx, page.ID, buildID)
	if perr != nil {
		return entity.Microsite{}, fmt.Errorf("set staging: %w", perr)
	}
	return updated, nil
}

// PromoteToLive — same as above + records previous, so Rollback can use it.
func PromoteToLive(
	ctx context.Context, deps MicrositeDeps, ownerID, slug, buildID string,
) (entity.Microsite, error) {
	page, err := promoteCheck(ctx, deps, ownerID, slug, buildID)
	if err != nil {
		return entity.Microsite{}, err
	}
	updated, perr := deps.Pages.SetLive(ctx, page.ID, buildID)
	if perr != nil {
		return entity.Microsite{}, fmt.Errorf("set live: %w", perr)
	}
	return updated, nil
}

// Rollback — promotes previous_live_build_id back to live.
func Rollback(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string,
) (entity.Microsite, error) {
	page, err := lookupPage(ctx, deps, ownerID, slug)
	if err != nil {
		return entity.Microsite{}, err
	}
	updated, rerr := deps.Pages.Rollback(ctx, page.ID)
	if rerr != nil {
		return entity.Microsite{}, fmt.Errorf("rollback: %w", rerr)
	}
	return updated, nil
}

// Unpublish — clear the live build so the page serves nothing; the homepage reverts to DefaultHome.
func Unpublish(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string,
) (entity.Microsite, error) {
	page, err := lookupPage(ctx, deps, ownerID, slug)
	if err != nil {
		return entity.Microsite{}, err
	}
	updated, cerr := deps.Pages.ClearLive(ctx, page.ID)
	if cerr != nil {
		return entity.Microsite{}, fmt.Errorf("clear live: %w", cerr)
	}
	return updated, nil
}

// DeletePage — soft delete (keeps the build artifact for audit). The reserved home slug is
// refused: it is pinned to `/`, and deleting it drops the site root to the fallback with no way
// back (the slug can be recreated since the index went partial, but `/` should never be a
// self-inflicted 404 in the first place — same guard RenamePage has).
func DeletePage(ctx context.Context, deps MicrositeDeps, ownerID, slug string) error {
	if slug == HomepageSlug {
		return entity.ErrMicrositeHomeReserved
	}
	page, lerr := lookupPage(ctx, deps, ownerID, slug)
	if lerr != nil {
		return lerr
	}
	// Drop the page's document schema FIRST (DROP SCHEMA CASCADE — the visitor data goes with it).
	// Before the soft-delete so a drop failure leaves the page intact and the caller can retry;
	// dropping after would risk a wiped store under a still-live page. No-leak is the invariant.
	if derr := dropPageStore(ctx, deps, page.ID); derr != nil {
		return derr
	}
	if derr := deps.Pages.Delete(ctx, page.ID); derr != nil {
		return fmt.Errorf("delete page: %w", derr)
	}
	return nil
}

// dropPageStore — drop the page's document schema, if a store is wired (no-op when it isn't).
func dropPageStore(ctx context.Context, deps MicrositeDeps, pageID string) error {
	if deps.Docs == nil {
		return nil
	}
	if derr := deps.Docs.Drop(ctx, pageID); derr != nil {
		return fmt.Errorf("drop page store: %w", derr)
	}
	return nil
}

// ListPages — for admin to display all active pages.
func ListPages(
	ctx context.Context, deps MicrositeDeps, ownerID string,
) ([]entity.Microsite, error) {
	pages, err := deps.Pages.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list pages: %w", err)
	}
	return pages, nil
}

// --- helpers ---------------------------------------------------------------

func lookupPage(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string,
) (entity.Microsite, error) {
	page, err := deps.Pages.GetBySlug(ctx, ownerID, slug)
	if err != nil {
		return entity.Microsite{}, fmt.Errorf("lookup page: %w", err)
	}
	return page, nil
}

// loadDraftFiles — fetches source_files from the latest build; if the latest is already
// built/failed, forks off of it (clones files). Returns an empty map when there's no build.
func loadDraftFiles(
	ctx context.Context, deps MicrositeDeps, pageID string,
) (map[string]string, error) {
	latest, err := deps.Builds.GetLatestForPage(ctx, pageID)
	if err != nil {
		if errors.Is(err, entity.ErrMicrositeBuildNotFound) {
			return map[string]string{}, nil
		}
		return nil, fmt.Errorf("get latest build: %w", err)
	}
	out := make(map[string]string, len(latest.SourceFiles))
	maps.Copy(out, latest.SourceFiles)
	return out, nil
}

func promoteCheck(
	ctx context.Context, deps MicrositeDeps, ownerID, slug, buildID string,
) (entity.Microsite, error) {
	page, perr := lookupPage(ctx, deps, ownerID, slug)
	if perr != nil {
		return entity.Microsite{}, perr
	}
	build, berr := deps.Builds.GetByID(ctx, buildID)
	if berr != nil {
		return entity.Microsite{}, fmt.Errorf("get build: %w", berr)
	}
	if err := assertBuildBelongsBuilt(&page, &build, buildID); err != nil {
		return entity.Microsite{}, err
	}
	return page, nil
}

func assertBuildBelongsBuilt(
	page *entity.Microsite, build *entity.MicrositeBuild, buildID string,
) error {
	if build.PageID != page.ID {
		return fmt.Errorf("build %s does not belong to %s", buildID, page.ID)
	}
	if build.Status != "built" {
		return fmt.Errorf("build %s status=%s, not built", buildID, build.Status)
	}
	return nil
}

// (slug / path / bundle-size validators moved to microsite_validate.go for the line-count gate.)
