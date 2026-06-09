// seo.go —— SEO 业务薄包装，让 routes/public/seo.go 不直接 import postgres。
// path-based (替代旧 slug)：landing URL 形如 /<handle>/wiki/<path>，path
// 可含 `/`（前端路由用 catch-all），同 retrieval ACL 复用同一列。

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// SEODeps —— SEO usecases 所需。Wiki/Output 用来 load 全树算公开 landing 地址
// (纯树派生,不读已退役的 path 列)。
type SEODeps struct {
	Owners *postgres.OwnerRepo
	SEO    *postgres.SEORepo
	Wiki   *postgres.WikiRepo
	Output *postgres.OutputRepo
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
// 地址纯树派生:load 全树算 id→path,匹配请求 path 且 indexed 的那条。
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
	wikis, err := deps.Wiki.ListByOwner(ctx, owner.ID, maxRAGWikis)
	if err != nil {
		return domain.Wiki{}, fmt.Errorf("list wiki: %w", err)
	}
	w, found := findIndexedWiki(wikis, path)
	if !found {
		return domain.Wiki{}, domain.ErrWikiNotFound
	}
	return w, nil
}

// findIndexedWiki —— 全树里挑 indexed 且树派生 path 命中那条。
func findIndexedWiki(wikis []domain.Wiki, path string) (domain.Wiki, bool) {
	paths := WikiTreePaths(wikis)
	for i := range wikis {
		if wikis[i].SEOIndexed() && paths[wikis[i].ID()] == path {
			return wikis[i], true
		}
	}
	return domain.Wiki{}, false
}

// LandingURL —— 一条 indexed landing 的 sitemap URL (wiki 或 output 通用)。
type LandingURL struct {
	Path      string
	UpdatedAt int64
}

// IndexedWikiLandings —— 给 sitemap.xml 列 sole owner 所有 indexed path（树派生）。
func IndexedWikiLandings(ctx context.Context, deps SEODeps) []LandingURL {
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []LandingURL{}
	}
	wikis, err := deps.Wiki.ListByOwner(ctx, owner.ID, maxRAGWikis)
	if err != nil {
		return []LandingURL{}
	}
	paths := WikiTreePaths(wikis)
	out := make([]LandingURL, 0, len(wikis))
	for i := range wikis {
		if wikis[i].SEOIndexed() {
			out = append(out, LandingURL{
				Path: paths[wikis[i].ID()], UpdatedAt: wikis[i].UpdatedAt().Unix(),
			})
		}
	}
	return out
}

// GetOutputLanding —— 公开 output landing 查询（同 wiki 的树派生口径）。
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
	outputs, err := deps.Output.ListByOwner(ctx, owner.ID, maxRAGOutputs)
	if err != nil {
		return domain.Output{}, fmt.Errorf("list output: %w", err)
	}
	o, found := findIndexedOutput(outputs, path)
	if !found {
		return domain.Output{}, domain.ErrOutputNotFound
	}
	return o, nil
}

// findIndexedOutput —— wiki 的 output 孪生。
func findIndexedOutput(outputs []domain.Output, path string) (domain.Output, bool) {
	paths := OutputTreePaths(outputs)
	for i := range outputs {
		if outputs[i].SEOIndexed() && paths[outputs[i].ID()] == path {
			return outputs[i], true
		}
	}
	return domain.Output{}, false
}

// IndexedOutputLandings —— sitemap.xml 列 indexed output landing（树派生）。
func IndexedOutputLandings(ctx context.Context, deps SEODeps) []LandingURL {
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []LandingURL{}
	}
	outputs, err := deps.Output.ListByOwner(ctx, owner.ID, maxRAGOutputs)
	if err != nil {
		return []LandingURL{}
	}
	paths := OutputTreePaths(outputs)
	out := make([]LandingURL, 0, len(outputs))
	for i := range outputs {
		if outputs[i].SEOIndexed() {
			out = append(out, LandingURL{
				Path: paths[outputs[i].ID()], UpdatedAt: outputs[i].UpdatedAt().Unix(),
			})
		}
	}
	return out
}
