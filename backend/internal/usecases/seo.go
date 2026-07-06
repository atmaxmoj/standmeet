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
	Owners   *postgres.OwnerRepo
	SEO      *postgres.SEORepo
	Wiki     *postgres.WikiRepo
	Output   *postgres.OutputRepo
	NoteRefs *postgres.NoteRefRepo
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

// WikiLanding —— landing 查询结果:wiki 实体 + 渲染好的 body(Obsidian `[[Title]]`
// 已 rewrite 成 /wiki/<path> 链接)+ 出链(Related)/入链(CitedBy)。
type WikiLanding struct {
	Body    string
	Related []WikiPathTitle
	CitedBy []WikiPathTitle
	Wiki    domain.Wiki
}

// wikiRefSides —— 一条 wiki 的出链 + 入链(给 landing 返回用)。
type wikiRefSides struct {
	Related []WikiPathTitle
	CitedBy []WikiPathTitle
}

// GetWikiLanding —— 公开 landing 查询：path → wiki entry（必须 published=true）+
// 渲染好的 body + read-next/cited-by。地址纯树派生:一次 load 全树,既定位目标条,
// 又建 title→path 索引给双链解析用。
func GetWikiLanding(
	ctx context.Context, deps SEODeps, path string,
) (WikiLanding, error) {
	if path == "" {
		return WikiLanding{}, domain.ErrWikiNotFound
	}
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return WikiLanding{}, domain.ErrOwnerNotFound
	}
	// 全量 meta(无 body、无 50-cap):算树派生 path 定位条目 + 建 [[X]] 渲染 title 索引。
	// deep entry(超出旧 newest-50)也找得到,链接也不断。正文单独 GetByID 拉。
	metas, err := deps.Wiki.ListAllMeta(ctx, owner.ID)
	if err != nil {
		return WikiLanding{}, fmt.Errorf("list wiki meta: %w", err)
	}
	return assembleWikiLanding(ctx, deps, owner.ID, metas, path)
}

func assembleWikiLanding(
	ctx context.Context, deps SEODeps, ownerID string, metas []postgres.WikiMeta, path string,
) (WikiLanding, error) {
	paths := WikiMetaTreePaths(metas)
	id, found := indexedWikiIDAtPath(metas, paths, path)
	if !found {
		return WikiLanding{}, domain.ErrWikiNotFound
	}
	w, gerr := deps.Wiki.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return WikiLanding{}, fmt.Errorf("get wiki: %w", gerr)
	}
	body := RewriteWikiCrossLinksForRender(w.Body(), wikiMetaPathTitleIndex(metas, paths))
	sides, serr := loadWikiRefSides(ctx, deps, ownerID, id, paths)
	if serr != nil {
		return WikiLanding{}, serr
	}
	return WikiLanding{Body: body, Related: sides.Related, CitedBy: sides.CitedBy, Wiki: w}, nil
}

// indexedWikiIDAtPath —— 全量 meta + 派生 path 里挑 indexed 且 path 命中那条的 id。
func indexedWikiIDAtPath(
	metas []postgres.WikiMeta, paths map[string]string, path string,
) (string, bool) {
	for i := range metas {
		if metas[i].Published && paths[metas[i].ID] == path {
			return metas[i].ID, true
		}
	}
	return "", false
}

// loadWikiRefSides —— 取这条 wiki 的出链(OutboundFor)+ 入链(BacklinksFor),
// ref 的 id 用全树派生 path 映射成 (title, path)。
func loadWikiRefSides(
	ctx context.Context, deps SEODeps, ownerID, wikiID string, paths map[string]string,
) (wikiRefSides, error) {
	out, oerr := deps.NoteRefs.OutboundFor(ctx, wikiID)
	if oerr != nil {
		return wikiRefSides{}, fmt.Errorf("wiki outbound: %w", oerr)
	}
	back, berr := deps.NoteRefs.BacklinksFor(ctx, ownerID, wikiID)
	if berr != nil {
		return wikiRefSides{}, fmt.Errorf("wiki backlinks: %w", berr)
	}
	return wikiRefSides{
		Related: wikiRefsToPathTitle(out, paths),
		CitedBy: wikiRefsToPathTitle(back, paths),
	}, nil
}

func wikiRefsToPathTitle(refs []postgres.NoteRef, paths map[string]string) []WikiPathTitle {
	out := make([]WikiPathTitle, 0, len(refs))
	for i := range refs {
		out = append(out, WikiPathTitle{Title: refs[i].Title, Path: paths[refs[i].ID]})
	}
	return out
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
	metas, err := deps.Wiki.ListAllMeta(ctx, owner.ID)
	if err != nil {
		return []LandingURL{}
	}
	paths := WikiMetaTreePaths(metas)
	out := make([]LandingURL, 0, len(metas))
	for i := range metas {
		if metas[i].Published {
			out = append(out, LandingURL{Path: paths[metas[i].ID], UpdatedAt: metas[i].UpdatedAt})
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
	return resolveOutputLanding(ctx, deps, owner.ID, path)
}

// resolveOutputLanding —— 全量 meta 定位 indexed + path 命中那条,正文 GetByID 拉。
func resolveOutputLanding(
	ctx context.Context, deps SEODeps, ownerID, path string,
) (domain.Output, error) {
	metas, err := deps.Output.ListAllMeta(ctx, ownerID)
	if err != nil {
		return domain.Output{}, fmt.Errorf("list output meta: %w", err)
	}
	id, found := indexedOutputIDAtPath(metas, OutputMetaTreePaths(metas), path)
	if !found {
		return domain.Output{}, domain.ErrOutputNotFound
	}
	o, gerr := deps.Output.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return domain.Output{}, fmt.Errorf("get output: %w", gerr)
	}
	return o, nil
}

// indexedOutputIDAtPath —— wiki 的 output 孪生:全量 meta 里挑 indexed + path 命中的 id。
func indexedOutputIDAtPath(
	metas []postgres.OutputMeta, paths map[string]string, path string,
) (string, bool) {
	for i := range metas {
		if metas[i].Published && paths[metas[i].ID] == path {
			return metas[i].ID, true
		}
	}
	return "", false
}

// IndexedOutputLandings —— sitemap.xml 列 indexed output landing（树派生）。
func IndexedOutputLandings(ctx context.Context, deps SEODeps) []LandingURL {
	owner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []LandingURL{}
	}
	metas, err := deps.Output.ListAllMeta(ctx, owner.ID)
	if err != nil {
		return []LandingURL{}
	}
	paths := OutputMetaTreePaths(metas)
	out := make([]LandingURL, 0, len(metas))
	for i := range metas {
		if metas[i].Published {
			out = append(out, LandingURL{Path: paths[metas[i].ID], UpdatedAt: metas[i].UpdatedAt})
		}
	}
	return out
}
