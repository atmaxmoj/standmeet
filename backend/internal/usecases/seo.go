// seo.go —— SEO 业务薄包装，让 routes/public/seo.go 不直接 import postgres。
// path-based (替代旧 slug)：landing URL 形如 /<handle>/wiki/<path>，path
// 可含 `/`（前端路由用 catch-all），同 retrieval ACL 复用同一列。

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

// PublicReady —— 集中 robots/sitemap readiness check。
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

// GetWikiLanding —— 公开 landing 查询：path → wiki entry（必须 seo_indexed=true）。
func GetWikiLanding(
	ctx context.Context, deps SEODeps, path string,
) (domain.Wiki, error) {
	if path == "" {
		return domain.Wiki{}, domain.ErrWikiNotFound
	}
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return domain.Wiki{}, domain.ErrOwnerNotFound
	}
	wiki, err := deps.SEO.GetWikiByPath(ctx, owner.ID, path)
	if err != nil {
		return domain.Wiki{}, fmt.Errorf("get wiki by path: %w", err)
	}
	return wiki, nil
}

// LandingURL —— 一条 indexed landing 的 sitemap URL (wiki 或 output 通用)。
type LandingURL struct {
	Path      string
	UpdatedAt int64
}

// IndexedWikiLandings —— 给 sitemap.xml 列 sole owner 所有 indexed path。
func IndexedWikiLandings(ctx context.Context, deps SEODeps) []LandingURL {
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []LandingURL{}
	}
	rows, err := deps.SEO.ListIndexedPaths(ctx, owner.ID)
	if err != nil {
		return []LandingURL{}
	}
	return toLandingURLs(rows)
}

// GetOutputLanding —— 公开 output landing 查询。
func GetOutputLanding(
	ctx context.Context, deps SEODeps, path string,
) (domain.Output, error) {
	if path == "" {
		return domain.Output{}, domain.ErrOutputNotFound
	}
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return domain.Output{}, domain.ErrOwnerNotFound
	}
	out, err := deps.SEO.GetOutputByPath(ctx, owner.ID, path)
	if err != nil {
		return domain.Output{}, fmt.Errorf("get output by path: %w", err)
	}
	return out, nil
}

// IndexedOutputLandings —— sitemap.xml 列 indexed output landing。
func IndexedOutputLandings(ctx context.Context, deps SEODeps) []LandingURL {
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []LandingURL{}
	}
	rows, err := deps.SEO.ListIndexedOutputPaths(ctx, owner.ID)
	if err != nil {
		return []LandingURL{}
	}
	return toLandingURLs(rows)
}

func toLandingURLs(rows []postgres.IndexedPath) []LandingURL {
	out := make([]LandingURL, 0, len(rows))
	for i := range rows {
		out = append(out, LandingURL{Path: rows[i].Path, UpdatedAt: rows[i].UpdatedAt})
	}
	return out
}
