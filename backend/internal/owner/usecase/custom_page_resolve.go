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

// ResolvePreviewBuild —— **owner 预览用**的那一版：这一页最近一次构建成功的。
//
// 为什么要单独一条：`/p/{slug}` 服务的是 live（resolveByOwner 读 LiveBuildID），
// 于是 agent 建完到 owner 点头之间的那一版，owner **没有任何地方看得见** ——
// 而那恰恰是他要看的那一版（看完才决定上不上线）。
//
// **一条规则，没有 fallback 链**：最近一次构建成功的，就这一条。
//   - 不看 staging_build_id：那要 agent 记得多调一次 promote_to_staging，
//     忘了 owner 就什么都看不见、而且不知道为什么。而 owner 要的是"看到它刚做了什么"。
//   - 只看 built：pending / building / failed 没有产物，渲出来是一片空白，
//     owner 会以为是自己写的页坏了。最近一次**成功**的那版仍然是他上次看到的东西，
//     而构建失败该由构建状态那一行说话，不是靠预览变白。
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
