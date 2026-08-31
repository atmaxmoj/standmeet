// boot_wireup_pages.go —— 公开侧**自定义页**那一族的装配。
//
// 从 boot_wireup.go 拆出来：那份到了 350 行上限，而这两个是同一件事的两个面 ——
// `/p/{slug}` 服务 live，预览凭令牌服务最近一次构建成功的。放一起，改一个时看得见另一个。

package main

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
)

func buildPublicCustomPageDeps(d *deps.Runtime) publicroutes.CustomPageHandlers {
	return publicroutes.CustomPageHandlers{
		Deps:       owner.CustomPageDeps{Pages: d.CustomPageRepo, Builds: d.CustomBuildRepo},
		Owners:     d.OwnerRepo,
		Log:        d.Log,
		BuildsRoot: d.BuildsRoot,
	}
}

func buildPublicCustomPagePreviewDeps(d *deps.Runtime) publicroutes.CustomPagePreviewHandlers {
	pageDeps := owner.CustomPageDeps{Pages: d.CustomPageRepo, Builds: d.CustomBuildRepo}
	return publicroutes.CustomPagePreviewHandlers{
		Log:        d.Log,
		BuildsRoot: d.BuildsRoot,
		// 两个函数在这里合上域：面那一层只拿答案，不认识域
		// （check-routes-via-dispatcher —— 面直接够到域就是绕过出站收口）。
		VerifyToken: func(slug, token string) (string, error) {
			return owner.VerifyPreviewToken(d.SessionKey, slug, token, time.Now())
		},
		ResolveBuild: func(
			ctx context.Context, ownerID, slug string,
		) (publicroutes.BuiltAsset, error) {
			page, err := owner.ResolvePreviewBuild(ctx, pageDeps, ownerID, slug)
			if err != nil {
				return publicroutes.BuiltAsset{}, fmt.Errorf("resolve preview build: %w", err)
			}
			return publicroutes.BuiltAsset{
				PageID: page.Build.PageID, BuildID: page.Build.ID,
				AllowBYOAI: page.AllowBYOAI,
			}, nil
		},
	}
}
