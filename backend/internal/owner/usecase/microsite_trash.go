// microsite_trash.go —— a deleted microsite waits in the trash for 90 days (owner, 2026-10-08: an
// asset, not configuration). DeletePage puts it there; these list it, restore it, and purge it with
// its builds, their files and its document store.

package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// micrositeTrashPurgeEvery —— a day's slack on a 90-day window is noise.
const micrositeTrashPurgeEvery = 24 * time.Hour

// TrashedPages —— the owner's deleted pages, newest delete first.
func TrashedPages(
	ctx context.Context, deps MicrositeDeps, ownerID string,
) ([]entity.TrashedMicrosite, error) {
	return deps.Pages.Trash(ctx, ownerID)
}

// RestorePage —— takes a page out of the trash with its builds (live included) and its store.
func RestorePage(ctx context.Context, deps MicrositeDeps, ownerID, pageID string) error {
	return deps.Pages.RestoreTrashed(ctx, ownerID, pageID)
}

// MicrositeTrashPeriodicJobs —— the daily purge. buildsRoot is the shared output volume
// (<root>/<page_id>/<build_id>/dist), whose files the cascade on the build rows cannot reach.
func MicrositeTrashPeriodicJobs(
	deps MicrositeDeps, buildsRoot string, log *slog.Logger,
) []periodic.Job {
	if deps.Pages == nil {
		return []periodic.Job{}
	}
	return []periodic.Job{periodic.Named(
		"microsite trash purge", micrositeTrashPurgeEvery,
		func(ctx context.Context) error {
			return purgeTrashedPages(ctx, deps, buildsRoot, log)
		},
	)}
}

func purgeTrashedPages(
	ctx context.Context, deps MicrositeDeps, buildsRoot string, log *slog.Logger,
) error {
	ids, err := deps.Pages.ExpiredTrash(ctx, time.Now().UTC().Add(-entity.MicrositeTrashRetention))
	if err != nil {
		return err
	}
	for _, id := range ids {
		if perr := purgeTrashedPage(ctx, deps, buildsRoot, id); perr != nil {
			return perr
		}
		log.Info("microsite trash: purged", "page_id", id)
	}
	return nil
}

// purgeTrashedPage —— store first, then the row: a failed drop leaves the page in the trash and the
// next run retries, instead of a row gone with its store still there. The files go last; a failure
// there leaves only bytes no row points at.
func purgeTrashedPage(ctx context.Context, deps MicrositeDeps, buildsRoot, id string) error {
	if err := dropPageStore(ctx, deps, id); err != nil {
		return err
	}
	if err := deps.Pages.Purge(ctx, id); err != nil {
		return err
	}
	if buildsRoot == "" {
		return nil
	}
	// id is a formatted uuid from the database: it cannot climb out of buildsRoot.
	if err := os.RemoveAll(filepath.Join(buildsRoot, id)); err != nil {
		return fmt.Errorf("remove purged page files: %w", err)
	}
	return nil
}
