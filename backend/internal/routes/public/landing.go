// landing.go —— #114 公开 corpus landing/reader 渲染(从原 seo.go 拆出)。
// GET /wiki/* + /output/* —— sole-owner instance,URL 不带 handle,chi wildcard
// 让 path 含 `/`(分组分段)。owner 不存在 / slug 不存在 / 非 public 都 404。
// robots.txt + sitemap.xml 是真 SEO,仍在 seo.go。handler 方法挂在 SEOHandlers 上
// (共用 Deps),命名的完整 SEO→landing 归一留后续一轮。

package public

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

func (h *SEOHandlers) getWikiLanding() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "*")
		// F-L-11 bearer-aware reader: a valid code bearer reads in-scope gated entries; anonymous
		// (no/dead token) → published-only (SEO). Same scope predicate the wiki-tree/context use.
		token, _ := bearerToken(r)
		scope := owner.WikiTreeScopeFor(r.Context(), h.Sessions, token)
		// ?lang= —— 访客要哪一种语言。**是查询参数不是路径段**:不是每条笔记都有同一套
		// 语言,`/zh/...` 那种形态会在没有中文的条目上碎掉。
		view, err := loadWikiLandingView(
			r.Context(), h.Deps, slug, scope, r.URL.Query().Get("lang"))
		if err != nil {
			handleLandingErr(h.Log, w, err)
			return
		}
		writeJSONWikiLanding(h.Log, w, &view)
	}
}

type wikiRefView struct {
	Title string `json:"title"`
	Path  string `json:"path"`
}

// wikiLandingView —— 字段序按指针宽度排(map → string → slice → 标量),govet
// fieldalignment 管着;读的时候按 json tag 看,别按行序推语义分组。
type wikiLandingView struct {
	// AssetURLs —— 正文里的 `standmeet-asset:<id>` 引用 + hero 图 → 可访问地址。
	// reader 照这张表把 URI 换成 URL 再渲染;没有它,访客看到的是一段渲不出来的 URI。
	AssetURLs map[string]string `json:"asset_urls"`
	Path      string            `json:"path"`
	Title     string            `json:"title"`
	Body      string            `json:"body"`
	Excerpt   string            `json:"excerpt"`
	UpdatedAt string            `json:"updated_at"`
	// hero 区 —— 封面图 + 压在图上那句话 + 色调。CoverImageAssetID 空 = owner 没设封面,
	// reader 退回程序生成的那块色板。
	CoverImageAssetID string        `json:"cover_image_asset_id"`
	CoverHeadline     string        `json:"cover_headline"`
	CoverHue          string        `json:"cover_hue"`
	Tags              []string      `json:"tags"`
	CSSClasses        []string      `json:"css_classes"` // per-note 呈现钩子;加到 .corpus-content
	Related           []wikiRefView `json:"related"`
	CitedBy           []wikiRefView `json:"cited_by"`
	// Assets —— 挂在这条上的文件(文件名 + 真实字节数 + 地址)。reader 拿它渲下载区。
	// **永不为 null**:空数组的意思是"没有附件",null 会被读成"这个字段坏了"。
	Assets []wikiAssetView `json:"assets"`
	// Lang / Languages —— 这份正文是哪一种语言,以及这条笔记有哪些语言可选(切换器用)。
	// 单语笔记:lang 空、languages 空数组。
	Lang      string         `json:"lang"`
	Languages []languageView `json:"languages"`
	// SourcesCount —— 这条 wiki 是从几条 raw 提炼来的(N corpus sources)。
	SourcesCount int `json:"sources_count"`
}

// wikiAssetView —— 一份附件在访客那一侧的样子。**不含 storage key、不含 holder id**:
// 访客要的是"叫什么、多大、从哪儿下",别的都不该出现在这条线上。
type wikiAssetView struct {
	AssetID     string `json:"asset_id"`
	Kind        string `json:"kind"`
	ContentType string `json:"content_type"`
	Filename    string `json:"original_filename"`
	URL         string `json:"url"`
	SizeBytes   int64  `json:"size_bytes"`
}

func toWikiAssetViews(assets []corpus.AssetView) []wikiAssetView {
	out := make([]wikiAssetView, 0, len(assets))
	for i := range assets {
		out = append(out, wikiAssetView{
			AssetID: assets[i].AssetID, Kind: assets[i].Kind,
			ContentType: assets[i].ContentType, Filename: assets[i].Filename,
			URL: assets[i].URL, SizeBytes: assets[i].SizeBytes,
		})
	}
	return out
}

// nonNilURLs —— nil map 序列化成 null,调用方要的是 {}。
func nonNilURLs(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}

func loadWikiLandingView(
	ctx context.Context, deps owner.SEODeps, slug string, scope owner.WikiTreeScope, lang string,
) (wikiLandingView, error) {
	res, err := owner.GetWikiLandingInLang(ctx, deps, slug, scope, lang)
	if err != nil {
		return wikiLandingView{}, err
	}
	return wikiLandingView{
		Path:              slug,
		Title:             res.Wiki.Title(),
		Body:              res.Body,
		AssetURLs:         nonNilURLs(res.AssetURLs),
		Excerpt:           res.Wiki.Excerpt(),
		UpdatedAt:         res.Wiki.UpdatedAt().UTC().Format(time.RFC3339),
		Tags:              res.Wiki.Tags(),
		CSSClasses:        res.Wiki.CSSClasses(),
		Related:           toWikiRefViews(res.Related),
		CitedBy:           toWikiRefViews(res.CitedBy),
		Assets:            toWikiAssetViews(res.Assets),
		CoverImageAssetID: res.Hero.CoverAssetID,
		CoverHeadline:     res.Hero.CoverHeadline,
		CoverHue:          res.Hero.CoverHue,
		SourcesCount:      len(res.Wiki.SourceRawIDs()),
		Lang:              res.I18n.Lang,
		Languages:         toLanguageViews(&res.I18n),
	}, nil
}

// languageView —— 切换器上的一项:码 + 显示的字。标签规则来自 vault 自己的 lang-labels
// (没写就按码生成),所以 vault 里和站点上看到的是同一套字。
type languageView struct {
	Code  string `json:"code"`
	Label string `json:"label"`
}

// toLanguageViews —— 语言集 → 切换器项。**永不为 null**:空数组的意思是"这条是单语的",
// null 会被读成"这个字段坏了"。
func toLanguageViews(meta *owner.LandingI18n) []languageView {
	out := make([]languageView, 0, len(meta.Languages))
	for _, code := range meta.Languages {
		out = append(out, languageView{Code: code, Label: corpus.I18nLabel(code, meta.Labels)})
	}
	return out
}

func toWikiRefViews(refs []corpus.WikiPathTitle) []wikiRefView {
	out := make([]wikiRefView, 0, len(refs))
	for i := range refs {
		out = append(out, wikiRefView{Title: refs[i].Title, Path: refs[i].Path})
	}
	return out
}

func writeJSONWikiLanding(log *slog.Logger, w http.ResponseWriter, view *wikiLandingView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode wiki landing", "err", err)
	}
}

func handleLandingErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := classifyLandingErr(err)
	if env.Status >= http.StatusInternalServerError {
		log.Error("wiki landing", "err", err)
	}
	writeError(log, w, env)
}

// landingNotFound —— wiki / output 公共 not-found envelope。
var landingNotFound = apierr.Envelope{
	Status: http.StatusNotFound, Code: "not_found", Message: "page not found",
}

// landingNotFoundSentinels —— landing 路径上视作 404 的 sentinel error 集合。
var landingNotFoundSentinels = []error{
	corpus.ErrWikiNotFound,
	corpus.ErrOutputNotFound,
	owner.ErrOwnerNotFound,
}

func isLandingNotFound(err error) bool {
	for _, sentinel := range landingNotFoundSentinels {
		if errors.Is(err, sentinel) {
			return true
		}
	}
	return false
}

func classifyLandingErr(err error) apierr.Envelope {
	if isLandingNotFound(err) {
		return landingNotFound
	}
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}

func (h *SEOHandlers) getOutputLanding() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "*")
		view, err := loadOutputLandingView(r.Context(), h.Deps, slug)
		if err != nil {
			handleLandingErr(h.Log, w, err)
			return
		}
		writeJSONOutputLanding(h.Log, w, &view)
	}
}

// outputLandingView —— 跟 wikiLandingView 字段对齐，前端 SDK 可复用渲染。
type outputLandingView struct {
	// AssetURLs —— 正文里的 `standmeet-asset:<id>` 引用 + hero 图 → 可访问地址。
	// 没有它,访客看到的是一个空图位(urlTransform 把非标准 scheme 静默剥掉,还不报错)。
	AssetURLs map[string]string `json:"asset_urls"`
	Path      string            `json:"path"`
	Title     string            `json:"title"`
	Body      string            `json:"body"`
	Excerpt   string            `json:"excerpt"`
	UpdatedAt string            `json:"updated_at"`
	// hero 区 —— 封面图 + 压在图上那句话 + 色调。空 = owner 没设。
	CoverImageAssetID string          `json:"cover_image_asset_id"`
	CoverHeadline     string          `json:"cover_headline"`
	CoverHue          string          `json:"cover_hue"`
	Assets            []wikiAssetView `json:"assets"`
}

func loadOutputLandingView(
	ctx context.Context, deps owner.SEODeps, slug string,
) (outputLandingView, error) {
	res, err := owner.GetOutputLanding(ctx, deps, slug)
	if err != nil {
		return outputLandingView{}, err
	}
	out := res.Output
	return outputLandingView{
		Path:              slug,
		Title:             out.Title(),
		Body:              out.Body(),
		Excerpt:           out.Excerpt(),
		UpdatedAt:         out.UpdatedAt().UTC().Format(time.RFC3339),
		AssetURLs:         nonNilURLs(res.AssetURLs),
		Assets:            toWikiAssetViews(res.Assets),
		CoverImageAssetID: res.Hero.CoverAssetID,
		CoverHeadline:     res.Hero.CoverHeadline,
		CoverHue:          res.Hero.CoverHue,
	}, nil
}

func writeJSONOutputLanding(log *slog.Logger, w http.ResponseWriter, view *outputLandingView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode output landing", "err", err)
	}
}
