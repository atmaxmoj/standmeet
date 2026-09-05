// microsite_autopublish.go — auto-go-live for the reserved `home` page (A Slice 5).
//
// InstallDefaultHomepage installs the homepage as a DRAFT at claim (create + write source), which
// queues a pending build. This takes it the last step: the moment that build FINISHES, if the page
// is the `home` page and isn't live yet, promote it — so a fresh instance serves its homepage at
// `/` with nothing for the owner to click.
//
// It is **event-driven, not a timer**: the build-completion path (routes/sys/builds MarkBuilt)
// hands us the finished build directly, so the whole context — which build, which page, and that
// it's built — is already known. No owner lookup, no "is it built yet" poll, no re-derivation. It
// acts only when the page isn't already live, so it can never fight a later owner edit.

package usecase

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// AutopublishHomepageOnBuilt — called right after a build is marked built. Promotes it only when it
// is the reserved home page's build and that page is not yet live. Any other build is ignored.
func AutopublishHomepageOnBuilt(
	ctx context.Context, deps MicrositeDeps, built *entity.MicrositeBuild, log *slog.Logger,
) error {
	page, err := deps.Pages.GetByID(ctx, built.PageID)
	if err != nil {
		return fmt.Errorf("homepage auto-publish: get page: %w", err)
	}
	if page.Slug != HomepageSlug || page.LiveBuildID != nil {
		return nil // not the homepage, or the owner already has a live build
	}
	if _, perr := PromoteToLive(ctx, deps, page.OwnerID, HomepageSlug, built.ID); perr != nil {
		return fmt.Errorf("homepage auto-publish: promote: %w", perr)
	}
	log.Info("homepage auto-published to live", "owner_id", page.OwnerID, "build_id", built.ID)
	return nil
}
