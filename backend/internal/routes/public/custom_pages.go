// custom_pages.go —— 访客访问 /<handle>/p/<slug> 时由 app middleware 反代
// 到 GET /api/v1/custom-pages/{handle}/{slug}/{*path}。本文件负责从共享
// /srv/custom-pages/<page_id>/<build_id>/dist/* 读文件返回。
//
// 安全：assetPath 必须不含 ..；path 拼装用 filepath.Clean 后强校验仍在
// BuildsRoot 子树下；只 serve build 已 built + 是 live。
//
// 这一层保持 cyclo ≤ 3：handle→owner→build 的链路集中在 usecases，文件
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
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// logErr —— slog key 常量，避免 "err" literal 在本文件出现过多次触发
// revive add-constant。集中一个出口对未来 structured log 迁移也更友好。
const logErr = "err"

// CustomPageHandlers —— 访客 custom page asset 路由依赖。
type CustomPageHandlers struct {
	Deps       usecases.CustomPageDeps
	Owners     usecases.OwnerByHandleLookup
	Log        *slog.Logger
	BuildsRoot string
}

// Mount 挂 /custom-pages/{handle}/{slug}/* 到 /api/v1。
func (h *CustomPageHandlers) Mount(r chi.Router) {
	r.Get("/custom-pages/{handle}/{slug}", h.serveAsset())
	r.Get("/custom-pages/{handle}/{slug}/*", h.serveAsset())
}

func (h *CustomPageHandlers) serveAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fp, err := resolveAssetPath(r.Context(), h, r)
		if err != nil {
			writeAssetErr(h.Log, w, err)
			return
		}
		serveFile(h.Log, w, fp, baseHrefFor(r))
	}
}

// baseHrefFor —— 给 index.html 注入 <base href> 用。空 assetPath 即根入口，
// 浏览器 URL 是 /<handle>/p/<slug>(/)?，所以 base 必须是
// /<handle>/p/<slug>/，让 vite emit 的 `./assets/...` 永远解析对路径。
func baseHrefFor(r *http.Request) string {
	asset := chi.URLParam(r, "*")
	if asset != "" {
		return ""
	}
	return fmt.Sprintf("/%s/p/%s/", chi.URLParam(r, "handle"), chi.URLParam(r, "slug"))
}

func resolveAssetPath(
	ctx context.Context, h *CustomPageHandlers, r *http.Request,
) (string, error) {
	build, err := usecases.ResolveLiveBuild(ctx,
		h.Deps, h.Owners,
		chi.URLParam(r, "handle"), chi.URLParam(r, "slug"))
	if err != nil {
		return "", err
	}
	return joinSafeAssetPath(h.BuildsRoot, build.PageID, build.ID, chi.URLParam(r, "*"))
}

// joinSafeAssetPath —— 把 owner-provided assetPath 拼成 host 文件路径，强校验
// 最终路径仍在 BuildsRoot 内。filepath.Clean + HasPrefix containment 兜底。
func joinSafeAssetPath(root, pageID, buildID, assetPath string) (string, error) {
	cleaned, ok := normalizeAssetRel(assetPath)
	if !ok {
		return "", domain.ErrCustomPageNotFound
	}
	buildRoot := filepath.Join(root, pageID, buildID, "dist")
	target := filepath.Join(buildRoot, cleaned)
	if !insideRoot(target, buildRoot) {
		return "", domain.ErrCustomPageNotFound
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

func serveFile(log *slog.Logger, w http.ResponseWriter, fp, baseHref string) {
	f, openErr := os.Open(filepath.Clean(fp))
	if openErr != nil {
		respondOpenErr(log, w, fp, openErr)
		return
	}
	defer closeAndLog(log, f)
	w.Header().Set("Content-Type", contentTypeFor(fp))
	if shouldInjectBase(fp, baseHref) {
		writeHTMLWithBase(log, w, f, baseHref)
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
// 让 vite 的 ./assets/... 永远以 /<handle>/p/<slug>/ 为基址。
func writeHTMLWithBase(log *slog.Logger, w http.ResponseWriter, f io.Reader, baseHref string) {
	body, err := io.ReadAll(f)
	if err != nil {
		log.Error("read html", logErr, err)
		return
	}
	out := injectBase(string(body), baseHref)
	if _, werr := io.WriteString(w, out); werr != nil {
		log.Warn("write html with base", logErr, werr)
	}
}

func injectBase(htmlBody, baseHref string) string {
	// html.EscapeString 把 baseHref 里可能的 " < > & 转义，杜绝攻击者用
	// 畸形 URL（比如 handle 含 quote）注入额外属性 → XSS。
	tag := `<base href="` + html.EscapeString(baseHref) + `">`
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
	log.Error("asset resolve", logErr, err)
	writeError(log, w, apierr.Envelope{
		Status:  http.StatusInternalServerError,
		Code:    "server_error",
		Message: fmt.Sprintf("internal: %v", err),
	})
}

// notFoundErrs —— 用 slice 而非 switch，让 isNotFoundErr cyclo 留在 2。
var notFoundErrs = []error{
	domain.ErrCustomPageNotFound,
	domain.ErrOwnerNotFound,
	domain.ErrCustomPageBuildNotFound,
}

func isNotFoundErr(err error) bool {
	for _, target := range notFoundErrs {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}
