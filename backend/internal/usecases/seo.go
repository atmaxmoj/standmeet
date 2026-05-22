// seo.go —— SEO 业务薄包装，让 routes/public/seo.go 不直接 import postgres。
// 当前每个方法就是 forward 到 SEORepo；将来加规则（slug 同义、redirect
// chain、og-cache）时这里是落点。

package usecases

import (
	"context"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// SEODeps —— SEO usecases 所需。
type SEODeps struct {
	Owners *postgres.OwnerRepo
	SEO    *postgres.SEORepo
}

// FirstOwner —— 取首位 owner 给 robots / sitemap 用；空 / err 都返 (Owner{}, false)。
func FirstOwner(ctx context.Context, deps SEODeps) (domain.Owner, bool) {
	handle, err := deps.Owners.FirstHandle(ctx)
	if err != nil || handle == "" {
		return domain.Owner{}, false
	}
	owner, oerr := deps.Owners.GetByHandle(ctx, handle)
	if oerr != nil {
		return domain.Owner{}, false
	}
	return owner, true
}

// FirstOwnerSettings —— SEO 渲染入口：拿首位 owner 的 SEOSettings。
func FirstOwnerSettings(ctx context.Context, deps SEODeps) (domain.SEOSettings, bool) {
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return domain.SEOSettings{}, false
	}
	settings, err := deps.SEO.GetSettings(ctx, owner.ID)
	if err != nil {
		return domain.SEOSettings{}, false
	}
	return settings, true
}

// PublicReady —— 集中 robots/sitemap readiness check：owner 存在 +
// public_url 已填 + SEO 设置允许 indexing。任一不满足返 (Owner{}, false)，
// caller (robots / sitemap) 按"还没准备好对外"渲染。
func PublicReady(ctx context.Context, deps SEODeps) (domain.Owner, bool) {
	owner, ok := FirstOwner(ctx, deps)
	if !ok || owner.PublicURL == "" {
		return domain.Owner{}, false
	}
	settings, ok := FirstOwnerSettings(ctx, deps)
	if !ok || !settings.IndexRobots {
		return domain.Owner{}, false
	}
	return owner, true
}

// GetWikiLanding —— 公开 landing 查询：slug → wiki entry（必须 public）。
// owner 是 sole owner（v1 单 owner），不需要按 handle 反查。
func GetWikiLanding(
	ctx context.Context, deps SEODeps, slug string,
) (domain.WikiEntry, error) {
	if slug == "" {
		return domain.WikiEntry{}, domain.ErrWikiNotFound
	}
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return domain.WikiEntry{}, domain.ErrOwnerNotFound
	}
	wiki, err := deps.SEO.GetWikiBySlug(ctx, owner.ID, slug)
	if err != nil {
		return domain.WikiEntry{}, fmt.Errorf("get wiki by slug: %w", err)
	}
	return wiki, nil
}

// WikiLandingURL —— 一条 indexed wiki landing 的 sitemap URL。
type WikiLandingURL struct {
	Slug      string
	UpdatedAt int64
}

// IndexedWikiLandings —— 给 sitemap.xml 列 sole owner 所有 indexed slug。
func IndexedWikiLandings(ctx context.Context, deps SEODeps) []WikiLandingURL {
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return nil
	}
	rows, err := deps.SEO.ListIndexedSlugs(ctx, owner.ID)
	if err != nil {
		return nil
	}
	out := make([]WikiLandingURL, 0, len(rows))
	for i := range rows {
		out = append(out, WikiLandingURL{Slug: rows[i].Slug, UpdatedAt: rows[i].UpdatedAt})
	}
	return out
}
