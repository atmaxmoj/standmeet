// custom_page_resolve.go —— 给 routes/public/custom_pages.go 用：把
// sole-owner→page→live_build 的多步链路集中在 usecase 层，让 handler
// 保持 cyclo ≤ 3。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner"
)

// SoleOwnerLookup —— ResolveLiveBuild 用，取 sole owner（v1 单 owner instance）。
// 让 routes 层不必直接依赖 postgres。
type SoleOwnerLookup interface {
	FirstHandle(ctx context.Context) (string, error)
	GetByHandle(ctx context.Context, handle string) (owner.Owner, error)
}

// ResolveLiveBuild —— 返回 sole owner 公开页里 slug 对应的 live build。
func ResolveLiveBuild(
	ctx context.Context, deps CustomPageDeps, owners SoleOwnerLookup, slug string,
) (owner.CustomPageBuild, error) {
	handle, herr := owners.FirstHandle(ctx)
	if herr != nil {
		return owner.CustomPageBuild{}, fmt.Errorf("first owner handle: %w", herr)
	}
	if handle == "" {
		return owner.CustomPageBuild{}, owner.ErrOwnerNotFound
	}
	soleOwner, oerr := owners.GetByHandle(ctx, handle)
	if oerr != nil {
		if errors.Is(oerr, owner.ErrOwnerNotFound) {
			return owner.CustomPageBuild{}, owner.ErrOwnerNotFound
		}
		return owner.CustomPageBuild{}, fmt.Errorf("get sole owner: %w", oerr)
	}
	return resolveByOwner(ctx, deps, soleOwner.ID, slug)
}

func resolveByOwner(
	ctx context.Context, deps CustomPageDeps, ownerID, slug string,
) (owner.CustomPageBuild, error) {
	page, perr := deps.Pages.GetBySlug(ctx, ownerID, slug)
	if perr != nil {
		return owner.CustomPageBuild{}, fmt.Errorf("get page: %w", perr)
	}
	if page.LiveBuildID == nil {
		return owner.CustomPageBuild{}, owner.ErrCustomPageNotFound
	}
	build, berr := deps.Builds.GetByID(ctx, *page.LiveBuildID)
	if berr != nil {
		return owner.CustomPageBuild{}, fmt.Errorf("get build: %w", berr)
	}
	return build, nil
}
