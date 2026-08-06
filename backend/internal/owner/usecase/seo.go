// seo.go —— SEO 业务薄包装，让 routes/public/seo.go 不直接 import postgres。
// path-based (替代旧 slug)：landing URL 形如 /<handle>/wiki/<path>，path
// 可含 `/`（前端路由用 catch-all），同 retrieval ACL 复用同一列。

package usecase

import (
	"context"
	"fmt"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// SEODeps —— SEO usecases 所需。Wiki/Output 用来 load 全树算公开 landing 地址
// (纯树派生,不读已退役的 path 列)。
type SEODeps struct {
	Owners   *repo.Repo
	SEO      *corpus.SEORepo
	Wiki     *corpus.WikiRepo
	Output   *corpus.OutputRepo
	NoteRefs *corpus.NoteRefRepo
	// Media —— 这条语料身上的素材。**任意 genre 都能挂**,所以 reader 也得能渲:
	// 正文里那些 `standmeet-asset:<id>` 引用要解析成可访问地址,否则访客看到的是一段
	// 渲不出来的 URI。以前只有 writing 那条路带这份数据,于是"每个 genre 都能配图"
	// 在后端成立、在访客眼里不成立。
	Media *corpus.NoteAssetsDeps
	// Vault —— 多语渲染要的那两个 frontmatter 字段(身份语言 + 切换器标签)。可空:
	// 没接上就当每条笔记都没写 lang,落点退成第一个语言面。
	Vault *corpus.VaultSyncRepo
}

// FirstOwner —— 取首位 owner 给 robots / sitemap 用；空 / err 都返 (Owner{}, false)。
func FirstOwner(ctx context.Context, deps SEODeps) (entity.Owner, bool) {
	handle, err := deps.Owners.FirstHandle(ctx)
	if err != nil || handle == "" {
		return entity.Owner{}, false
	}
	soleOwner, oerr := deps.Owners.GetByHandle(ctx, handle)
	if oerr != nil {
		return entity.Owner{}, false
	}
	return soleOwner, true
}

// FirstOwnerSettings —— SEO 渲染入口：拿首位 owner 的 SEOSettings。
func FirstOwnerSettings(ctx context.Context, deps SEODeps) (corpus.SEOSettings, bool) {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return corpus.SEOSettings{}, false
	}
	settings, err := deps.SEO.GetSettings(ctx, soleOwner.ID)
	if err != nil {
		return corpus.SEOSettings{}, false
	}
	return settings, true
}

// PublicReady —— 集中 robots/sitemap readiness check。
func PublicReady(ctx context.Context, deps SEODeps) (entity.Owner, bool) {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok || soleOwner.PublicURL == "" {
		return entity.Owner{}, false
	}
	settings, ok := FirstOwnerSettings(ctx, deps)
	if !ok || !settings.IndexRobots {
		return entity.Owner{}, false
	}
	return soleOwner, true
}

// WikiLanding —— landing 查询结果:wiki 实体 + 渲染好的 body(Obsidian `[[Title]]`
// 已 rewrite 成 /wiki/<path> 链接)+ 出链(Related)/入链(CitedBy)。
type WikiLanding struct {
	// AssetURLs —— 正文里的 `standmeet-asset:<id>` 引用 + hero 图 → 可访问地址。
	// 渲染那一侧照这张表把 URI 换成 URL。
	AssetURLs map[string]string
	Body      string
	Related   []corpus.WikiPathTitle
	CitedBy   []corpus.WikiPathTitle
	// Assets —— 挂在这条上的文件清单(文件名 + 真实字节数 + 地址)。下载按钮要的就是这几项。
	Assets []corpus.AssetView
	// I18n —— 这条笔记的多语视图:选中的那一面 + 有哪些语言 + 切换器标签。
	// 单语笔记 Languages 为空,读者页据此不出切换器。
	I18n LandingI18n
	// Hero —— 封面图 / 压在图上那句话 / 色调。**任意 genre 都能有**,住在共享的 hero 表上。
	Hero corpus.NoteHero
	Wiki corpus.Wiki
}

// LandingI18n —— 读者页要的那几项。Body 已经按选中的语言渲染好(在 WikiLanding.Body 里),
// 这里只带"选了哪个 / 有哪些 / 各自显示成什么"。
type LandingI18n struct {
	Labels    map[string]string
	Lang      string
	Languages []string
}

// wikiRefSides —— 一条 wiki 的出链 + 入链(给 landing 返回用)。
type wikiRefSides struct {
	Related []corpus.WikiPathTitle
	CitedBy []corpus.WikiPathTitle
}

// GetWikiLanding —— 公开 landing 查询：path → wiki entry + 渲染好的 body + read-next/cited-by。
// 地址纯树派生:一次 load 全树,既定位目标条,又建 title→path 索引给双链解析用。
//
// scope 决定一条能不能被这个查看者读到（F-L-11 bearer-aware reader）:匿名 = PublicWikiScope
// (只 published,给爬虫/SEO);带有效 code bearer = RoleWikiScope(该 code role 的 corpus glob 内
// 的条目,不论 published) —— owner 的访问模型是「published(匿名)+ code(受邀 scope)」。
func GetWikiLanding(
	ctx context.Context, deps SEODeps, path string, scope WikiTreeScope,
) (WikiLanding, error) {
	return GetWikiLandingInLang(ctx, deps, path, scope, "")
}

// GetWikiLandingInLang —— 同上,外加访客要的语言(`?lang=`)。
func GetWikiLandingInLang(
	ctx context.Context, deps SEODeps, path string, scope WikiTreeScope, lang string,
) (WikiLanding, error) {
	if path == "" {
		return WikiLanding{}, corpus.ErrWikiNotFound
	}
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return WikiLanding{}, entity.ErrOwnerNotFound
	}
	// 全量 meta(无 body、无 50-cap):算树派生 path 定位条目 + 建 [[X]] 渲染 title 索引。
	// deep entry(超出旧 newest-50)也找得到,链接也不断。正文单独 GetByID 拉。
	metas, err := deps.Wiki.ListAllMeta(ctx, soleOwner.ID)
	if err != nil {
		return WikiLanding{}, fmt.Errorf("list wiki meta: %w", err)
	}
	return assembleWikiLanding(ctx, deps, soleOwner.ID,
		&landingLocate{scope: scope, path: path, metas: metas, lang: lang})
}

// landingLocate —— 定位一条 landing 的输入(全量 meta + 目标 path + 查看者 scope)。打包成一个入参
// 让 assembleWikiLanding 守 argument-limit。字段序为 fieldalignment。
type landingLocate struct {
	scope WikiTreeScope
	path  string
	// lang —— 访客要的语言(`?lang=`)。空 = 按这条笔记的身份语言。
	lang  string
	metas []corpus.WikiMeta
}

func assembleWikiLanding(
	ctx context.Context, deps SEODeps, ownerID string, loc *landingLocate,
) (WikiLanding, error) {
	paths := corpus.WikiMetaTreePaths(loc.metas)
	id, found := indexedWikiIDAtPath(loc.metas, paths, loc.path, loc.scope)
	if !found {
		return WikiLanding{}, corpus.ErrWikiNotFound
	}
	w, gerr := deps.Wiki.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return WikiLanding{}, fmt.Errorf("get wiki: %w", gerr)
	}
	body := corpus.RewriteWikiCrossLinksForRender(
		w.Body(), corpus.WikiMetaPathTitleIndex(loc.metas, paths),
	)
	sides, serr := loadWikiRefSides(ctx, deps, ownerID, id, paths)
	if serr != nil {
		return WikiLanding{}, serr
	}
	media := landingMedia(ctx, deps, ownerID, id)
	view := landingI18n(ctx, deps,
		&landingNote{ownerID: ownerID, id: id, body: body}, loc.lang)
	return WikiLanding{
		Body: view.body, Related: sides.Related, CitedBy: sides.CitedBy, Wiki: w,
		AssetURLs: media.URLs, Hero: media.Hero, Assets: media.Assets, I18n: view.meta,
	}, nil
}

// landingMedia —— 这条语料身上跟素材有关的全部:引用解析出的地址、hero 三件套、附件清单。
//
// 以前这里只取 URLs,把 hero 和附件扔了 —— 于是 owner 设的封面图到不了访客页面(那边永远
// 是按 slug hash 生成的色块),附件更是连字段都没有。**读的时候三样一起取,是因为它们本来
// 就是一次查询的结果**;只带走一样,另外两样就得再开一条路。
//
// 取不到只当没有:一份素材出问题不该让整个页面打不开。没接素材存储(某些只读装配)同理。
func landingMedia(
	ctx context.Context, deps SEODeps, ownerID, noteID string,
) corpus.NoteMediaView {
	media, ok := corpus.LoadNoteMedia(ctx, deps.Media, ownerID, noteID)
	if !ok {
		return corpus.NoteMediaView{URLs: map[string]string{}, Assets: []corpus.AssetView{}}
	}
	return media
}

// indexedWikiIDAtPath —— 全量 meta + 派生 path 里挑 path 命中且**这个查看者能看到**的那条 id。
// 可见性交给 scope(匿名 = 只 published;code = role glob 内),不再写死 published（F-L-11）。
func indexedWikiIDAtPath(
	metas []corpus.WikiMeta, paths map[string]string, path string, scope WikiTreeScope,
) (string, bool) {
	for i := range metas {
		if paths[metas[i].ID] == path && scope(metas[i].Published, path) {
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

func wikiRefsToPathTitle(refs []corpus.NoteRef, paths map[string]string) []corpus.WikiPathTitle {
	out := make([]corpus.WikiPathTitle, 0, len(refs))
	for i := range refs {
		out = append(out, corpus.WikiPathTitle{Title: refs[i].Title, Path: paths[refs[i].ID]})
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
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []LandingURL{}
	}
	metas, err := deps.Wiki.ListAllMeta(ctx, soleOwner.ID)
	if err != nil {
		return []LandingURL{}
	}
	paths := corpus.WikiMetaTreePaths(metas)
	out := make([]LandingURL, 0, len(metas))
	for i := range metas {
		if metas[i].Published {
			out = append(out, LandingURL{Path: paths[metas[i].ID], UpdatedAt: metas[i].UpdatedAt})
		}
	}
	return out
}

// OutputLanding —— 一条 output 的落地页。**跟 WikiLanding 一样带素材** ——
// 以前它只回一个 corpus.Output,于是访客那边正文里的 standmeet-asset 渲不出来、
// owner 设的封面到不了前端、附件连字段都没有。底下的机制一直是 genre 无关的,
// 缺的只是这里没把 media 带出去。
type OutputLanding struct {
	AssetURLs map[string]string
	Assets    []corpus.AssetView
	Hero      corpus.NoteHero
	Output    corpus.Output
}

// GetOutputLanding —— 公开 output landing 查询(同 wiki 的树派生口径),连同它身上的素材。
func GetOutputLanding(
	ctx context.Context, deps SEODeps, path string,
) (OutputLanding, error) {
	if path == "" {
		return OutputLanding{}, corpus.ErrOutputNotFound
	}
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return OutputLanding{}, entity.ErrOwnerNotFound
	}
	out, err := resolveOutputLanding(ctx, deps, soleOwner.ID, path)
	if err != nil {
		return OutputLanding{}, err
	}
	media := landingMedia(ctx, deps, soleOwner.ID, out.ID())
	return OutputLanding{
		Output: out, AssetURLs: media.URLs, Assets: media.Assets, Hero: media.Hero,
	}, nil
}

// resolveOutputLanding —— 全量 meta 定位 indexed + path 命中那条,正文 GetByID 拉。
func resolveOutputLanding(
	ctx context.Context, deps SEODeps, ownerID, path string,
) (corpus.Output, error) {
	metas, err := deps.Output.ListAllMeta(ctx, ownerID)
	if err != nil {
		return corpus.Output{}, fmt.Errorf("list output meta: %w", err)
	}
	id, found := indexedOutputIDAtPath(metas, corpus.OutputMetaTreePaths(metas), path)
	if !found {
		return corpus.Output{}, corpus.ErrOutputNotFound
	}
	o, gerr := deps.Output.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return corpus.Output{}, fmt.Errorf("get output: %w", gerr)
	}
	return o, nil
}

// indexedOutputIDAtPath —— wiki 的 output 孪生:全量 meta 里挑 indexed + path 命中的 id。
func indexedOutputIDAtPath(
	metas []corpus.OutputMeta, paths map[string]string, path string,
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
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []LandingURL{}
	}
	metas, err := deps.Output.ListAllMeta(ctx, soleOwner.ID)
	if err != nil {
		return []LandingURL{}
	}
	paths := corpus.OutputMetaTreePaths(metas)
	out := make([]LandingURL, 0, len(metas))
	for i := range metas {
		if metas[i].Published {
			out = append(out, LandingURL{Path: paths[metas[i].ID], UpdatedAt: metas[i].UpdatedAt})
		}
	}
	return out
}
