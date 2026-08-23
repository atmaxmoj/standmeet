// custom_page_resolve.go —— 给 routes/public/custom_pages.go 用：把
// sole-owner→page→live_build 的多步链路集中在 usecase 层，让 handler
// 保持 cyclo ≤ 3。

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// SoleOwnerLookup —— ResolveLiveBuild 用，取 sole owner（v1 单 owner instance）。
// 让 routes 层不必直接依赖 postgres。
type SoleOwnerLookup interface {
	FirstHandle(ctx context.Context) (string, error)
	GetByHandle(ctx context.Context, handle string) (entity.Owner, error)
}

// ResolveLiveBuild —— 返回 sole owner 公开页里 slug 对应的 live build + 这一页的设置。
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

// LivePage —— 正在服务的这一页：哪一次构建的产物，加上**这一刻**页自己的设置。
// 两样一起返回，是因为服务一次请求的两个决定（读哪些文件、这一页给不给自带 key）
// 用的是同一行记录 —— 分两次查会给出两个时刻的答案。
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
