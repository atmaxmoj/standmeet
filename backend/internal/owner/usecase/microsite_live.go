// microsite_live.go —— moving a microsite's live pointer: promote, roll back, unpublish. Each
// move and its page.* event commit in one transaction (pageFact).

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PromoteToLive — same as PromoteToStaging + records previous, so Rollback can use it.
func PromoteToLive(
	ctx context.Context, deps MicrositeDeps, ownerID, slug, buildID string,
) (entity.Microsite, error) {
	page, err := promoteCheck(ctx, deps, ownerID, slug, buildID)
	if err != nil {
		return entity.Microsite{}, err
	}
	updated, perr := pageFact(ctx, deps, PagePromotedLive, &page,
		func(p *repo.MicrositeRepo) (entity.Microsite, error) {
			return p.SetLive(ctx, page.ID, buildID)
		})
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
	updated, rerr := pageFact(ctx, deps, PageRolledBack, &page,
		func(p *repo.MicrositeRepo) (entity.Microsite, error) { return p.Rollback(ctx, page.ID) })
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
	updated, cerr := pageFact(ctx, deps, PageUnpublished, &page,
		func(p *repo.MicrositeRepo) (entity.Microsite, error) { return p.ClearLive(ctx, page.ID) })
	if cerr != nil {
		return entity.Microsite{}, fmt.Errorf("clear live: %w", cerr)
	}
	return updated, nil
}

// pageFact —— move a microsite's live pointer and record typ, in one transaction.
func pageFact(
	ctx context.Context, deps MicrositeDeps, typ string, page *entity.Microsite,
	write func(p *repo.MicrositeRepo) (entity.Microsite, error),
) (entity.Microsite, error) {
	var out entity.Microsite
	err := pgstore.InTx(ctx, deps.Pages.Pool(), func(tx pgstore.Tx) error {
		var werr error
		if out, werr = write(deps.Pages.With(tx)); werr != nil {
			return werr
		}
		data := map[string]string{"microsite_id": out.ID}
		if out.LiveBuildID != nil {
			data["build_id"] = *out.LiveBuildID
		}
		return deps.Events().With(tx).Record(ctx, page.OwnerID, typ, "microsite/"+page.Slug, data)
	})
	return out, err //nolint:wrapcheck // the callers name the step
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
