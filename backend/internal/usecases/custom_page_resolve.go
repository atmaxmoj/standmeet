// custom_page_resolve.go —— 给 routes/public/custom_pages.go 用：把
// handle→owner→page→live_build 的多步链路集中在 usecase 层，让 handler
// 保持 cyclo ≤ 3。

package usecases

import (
	"context"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
)

// OwnerByHandleLookup —— ResolveLiveBuild 用，按 handle 取 owner。让 routes
// 层不必直接依赖 postgres。
type OwnerByHandleLookup interface {
	GetByHandle(ctx context.Context, handle string) (domain.Owner, error)
}

// ResolveLiveBuild —— 返回 owner 公开页里 slug 对应的 live build。
func ResolveLiveBuild(
	ctx context.Context, deps CustomPageDeps, owners OwnerByHandleLookup,
	handle, slug string,
) (domain.CustomPageBuild, error) {
	owner, oerr := owners.GetByHandle(ctx, handle)
	if oerr != nil {
		return domain.CustomPageBuild{}, fmt.Errorf("get owner: %w", oerr)
	}
	return resolveByOwner(ctx, deps, owner.ID, slug)
}

func resolveByOwner(
	ctx context.Context, deps CustomPageDeps, ownerID, slug string,
) (domain.CustomPageBuild, error) {
	page, perr := deps.Pages.GetBySlug(ctx, ownerID, slug)
	if perr != nil {
		return domain.CustomPageBuild{}, fmt.Errorf("get page: %w", perr)
	}
	if page.LiveBuildID == nil {
		return domain.CustomPageBuild{}, domain.ErrCustomPageNotFound
	}
	build, berr := deps.Builds.GetByID(ctx, *page.LiveBuildID)
	if berr != nil {
		return domain.CustomPageBuild{}, fmt.Errorf("get build: %w", berr)
	}
	return build, nil
}
