// custom_pages.go —— 访客访问 /p/<slug> 时由 app middleware 反代到
// GET /api/v1/custom-pages/{slug}/{*path}。本文件负责从共享
// /srv/custom-pages/<page_id>/<build_id>/dist/* 读文件返回。
//
// 安全：assetPath 必须不含 ..；path 拼装用 filepath.Clean 后强校验仍在
// BuildsRoot 子树下；只 serve build 已 built + 是 live。
//
// 这一层保持 cyclo ≤ 3：sole-owner→build 链路集中在 usecases，文件
// resolve 用 helper 拆开，content-type 用 map 查。

package public

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// logErr —— slog key 常量，避免 "err" literal 在本文件出现过多次触发
// revive add-constant。集中一个出口对未来 structured log 迁移也更友好。
const logErr = "err"

// CustomPageHandlers —— 访客 custom page asset 路由依赖。
type CustomPageHandlers struct {
	Deps       owner.CustomPageDeps
	Owners     owner.SoleOwnerLookup
	Log        *slog.Logger
	BuildsRoot string
}

// Mount 挂 /custom-pages/{slug}/* 到 /api/v1。owner 是 sole owner，URL 不带 handle。
func (h *CustomPageHandlers) Mount(r chi.Router) {
	r.Get("/custom-pages/{slug}", h.serveAsset())
	r.Get("/custom-pages/{slug}/*", h.serveAsset())
}

func (h *CustomPageHandlers) serveAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// **不许被当成快照。** owner 撤下（rollback / delete）之后，这个地址就该停止服务；
		// 而这一路以前一个 Cache-Control 都没发 —— 没有头，浏览器按启发式自己缓存，
		// 于是撤下的页面照样打得开。那不是「浏览器自己缓存了」，是我们没说别缓存。
		// 唯一该落在我们控制之外的，是读者已经存进本地的那一份。
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		asset, err := resolveAsset(r.Context(), h, r)
		if err != nil {
			writeAssetErr(h.Log, w, err)
			return
		}
		serveFile(h.Log, w, asset.path, headFor(r, asset.allowBYOAI))
	}
}

// pageHead —— 服务 index.html 时要注进 <head> 的东西。空 base = 这一次不是根入口
// （子资源请求），什么都不注。
type pageHead struct {
	base       string
	allowBYOAI bool
}

func headFor(r *http.Request, allowBYOAI bool) pageHead {
	return pageHead{base: baseHrefFor(r), allowBYOAI: allowBYOAI}
}

// tags —— 注进 <head> 的那几行。
//
// byoai 那一条**每次请求现读**：owner 在面板上关掉自带 key，下一次打开这一页就是新值 ——
// 页面里不存快照，也不必再多问一个端点。这跟不发缓存头是同一件事的两半
// （撤下的东西必须立刻停止生效）。
func (p pageHead) tags() string {
	return `<base href="` + html.EscapeString(p.base) + `">` +
		`<meta name="standmeet-page-byoai" content="` + strconv.FormatBool(p.allowBYOAI) + `">`
}

// baseHrefFor —— 给 index.html 注入 <base href> 用。空 assetPath 即根入口，
// 浏览器 URL 是 /p/<slug>(/)?，所以 base 必须是 /p/<slug>/，让 vite emit
// 的 `./assets/...` 永远解析对路径。
func baseHrefFor(r *http.Request) string {
	asset := chi.URLParam(r, "*")
	if asset != "" {
		return ""
	}
	return fmt.Sprintf("/p/%s/", chi.URLParam(r, "slug"))
}

// resolvedAsset —— 这一次要给出的文件，加上服务它时页自己的设置。
type resolvedAsset struct {
	path       string
	allowBYOAI bool
}

func resolveAsset(
	ctx context.Context, h *CustomPageHandlers, r *http.Request,
) (resolvedAsset, error) {
	live, err := owner.ResolveLiveBuild(ctx, h.Deps, h.Owners, chi.URLParam(r, "slug"))
	if err != nil {
		return resolvedAsset{}, err
	}
	fp, perr := joinSafeAssetPath(
		h.BuildsRoot, live.Build.PageID, live.Build.ID, chi.URLParam(r, "*"))
	if perr != nil {
		return resolvedAsset{}, perr
	}
	return resolvedAsset{path: fp, allowBYOAI: live.AllowBYOAI}, nil
}

// joinSafeAssetPath —— 把 owner-provided assetPath 拼成 host 文件路径，强校验
// 最终路径仍在 BuildsRoot 内。filepath.Clean + HasPrefix containment 兜底。
func joinSafeAssetPath(root, pageID, buildID, assetPath string) (string, error) {
	cleaned, ok := normalizeAssetRel(assetPath)
	if !ok {
		return "", owner.ErrCustomPageNotFound
	}
	buildRoot := filepath.Join(root, pageID, buildID, "dist")
	target := filepath.Join(buildRoot, cleaned)
	if !insideRoot(target, buildRoot) {
		return "", owner.ErrCustomPageNotFound
	}
	return target, nil
}

func normalizeAssetRel(assetPath string) (string, bool) {
	rel := assetPath
	if rel == "" {
		rel = "index.html"
	}
	cleaned := filepath.Clean("/" + rel)[1:] // strip leading /; absorbs ../
	if !cleanedRelOK(cleaned) {
		return "", false
	}
	return cleaned, true
}

func cleanedRelOK(c string) bool {
	if c == "" {
		return false
	}
	return !strings.HasPrefix(c, "..")
}

func insideRoot(target, buildRoot string) bool {
	return target == buildRoot ||
		strings.HasPrefix(target, buildRoot+string(filepath.Separator))
}

func serveFile(log *slog.Logger, w http.ResponseWriter, fp string, head pageHead) {
	f, openErr := os.Open(filepath.Clean(fp))
	if openErr != nil {
		respondOpenErr(log, w, fp, openErr)
		return
	}
	defer closeAndLog(log, f)
	w.Header().Set("Content-Type", contentTypeFor(fp))
	if shouldInjectBase(fp, head.base) {
		writeHTMLWithBase(log, w, f, head)
		return
	}
	streamFile(log, w, f)
}

func shouldInjectBase(fp, baseHref string) bool {
	return baseHref != "" && strings.EqualFold(filepath.Ext(fp), ".html")
}

func streamFile(log *slog.Logger, w io.Writer, f io.Reader) {
	if _, err := io.Copy(w, f); err != nil {
		log.Warn("write asset", logErr, err)
	}
}

// writeHTMLWithBase —— 流式读 index.html，遇到 `<head>` 后插 `<base href>`，
// 让 vite 的 ./assets/... 永远以 /p/<slug>/ 为基址（实例单 owner，URL 不带 handle —— F-L-44）。
func writeHTMLWithBase(log *slog.Logger, w http.ResponseWriter, f io.Reader, head pageHead) {
	body, err := io.ReadAll(f)
	if err != nil {
		log.Error("read html", logErr, err)
		return
	}
	out := injectHead(string(body), head)
	if _, werr := io.WriteString(w, out); werr != nil {
		log.Warn("write html with base", logErr, werr)
	}
}

// injectHead —— 把 <base> 和这一页的设置注进 <head>。
// html.EscapeString 把 baseHref 里可能的 " < > & 转义，杜绝攻击者用
// 畸形 URL（比如 handle 含 quote）注入额外属性 → XSS。
func injectHead(htmlBody string, head pageHead) string {
	tag := head.tags()
	if i := strings.Index(htmlBody, "<head>"); i >= 0 {
		return htmlBody[:i+len("<head>")] + tag + htmlBody[i+len("<head>"):]
	}
	return tag + htmlBody
}

func respondOpenErr(log *slog.Logger, w http.ResponseWriter, fp string, err error) {
	if errors.Is(err, os.ErrNotExist) {
		http.Error(w, "asset not found", http.StatusNotFound)
		return
	}
	log.Error("open asset", "path", fp, logErr, err)
	http.Error(w, "asset error", http.StatusInternalServerError)
}

func closeAndLog(log *slog.Logger, f *os.File) {
	if err := f.Close(); err != nil {
		log.Warn("close asset", logErr, err)
	}
}

// contentTypeByExt —— 顶层 map 让 contentTypeFor 走查表，cyclo 保持 1。
var contentTypeByExt = map[string]string{
	".html": "text/html; charset=utf-8",
	".js":   "application/javascript; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg":  "image/svg+xml",
}

func contentTypeFor(fp string) string {
	ext := strings.ToLower(filepath.Ext(fp))
	if ct, ok := contentTypeByExt[ext]; ok {
		return ct
	}
	return "application/octet-stream"
}

func writeAssetErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if isNotFoundErr(err) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "not_found", Message: "page not found",
		})
		return
	}
	// Raw err logged above for ops; the browser only sees a static message
	// (never the underlying resolve/build/fs error via %v).
	log.Error("asset resolve", logErr, err)
	writeError(log, w, apierr.Envelope{
		Status:  http.StatusInternalServerError,
		Code:    "server_error",
		Message: "internal error",
	})
}

// notFoundErrs —— 用 slice 而非 switch，让 isNotFoundErr cyclo 留在 2。
var notFoundErrs = []error{
	owner.ErrCustomPageNotFound,
	owner.ErrOwnerNotFound,
	owner.ErrCustomPageBuildNotFound,
}

func isNotFoundErr(err error) bool {
	for _, target := range notFoundErrs {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}
