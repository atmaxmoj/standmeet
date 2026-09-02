// custom_pages.go —— when a visitor hits /p/<slug>, app middleware reverse-proxies it
// to GET /api/v1/custom-pages/{slug}/{*path}. This file is responsible for reading the
// file back from the shared /srv/custom-pages/<page_id>/<build_id>/dist/* tree.
//
// Security: assetPath must not contain ..; the joined path is filepath.Clean'd and then
// strictly checked to still be under the BuildsRoot subtree; only a build that is both
// built and live is served.
//
// This layer stays at cyclo ≤ 3: the sole-owner→build chain lives in usecases, file
// resolution is split into a helper, content-type is a map lookup.

package public

import (
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

// logErr —— a slog key constant, to keep the "err" literal from appearing too many
// times in this file and tripping revive add-constant. Funneling through one place is
// also friendlier for a future structured-log migration.
const logErr = "err"

// CustomPageHandlers —— dependencies for the visitor custom-page asset route.
type CustomPageHandlers struct {
	Deps       owner.CustomPageDeps
	Owners     owner.SoleOwnerLookup
	Log        *slog.Logger
	BuildsRoot string
}

// Mount wires /custom-pages/{slug}/* onto /api/v1. The owner is a sole owner, so the
// URL carries no handle.
func (h *CustomPageHandlers) Mount(r chi.Router) {
	r.Get("/custom-pages/{slug}", h.serveAsset())
	r.Get("/custom-pages/{slug}/*", h.serveAsset())
}

func (h *CustomPageHandlers) serveAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// **Must never be treated as a snapshot.** Once the owner takes it down
		// (rollback / delete), this address should stop serving; and this route used to
		// send no Cache-Control header at all — with no header, the browser caches it by
		// heuristic on its own, so a taken-down page kept opening fine. That isn't "the
		// browser caching it on its own", it's us never having said not to. The only
		// thing that should fall outside our control is a copy a reader has already
		// saved locally.
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		// The file-serving part is shared with the admin preview
		// (custom_page_serve.go) — they differ only in **which build to look at**, and
		// path-escape validation must only ever exist once.
		ctx := r.Context()
		ServeBuildAsset(w, r, &BuildAssetReq{
			Log:        h.Log,
			BuildsRoot: h.BuildsRoot,
			Resolve: func() (BuiltAsset, error) {
				live, lerr := owner.ResolveLiveBuild(
					ctx, h.Deps, h.Owners, chi.URLParam(r, "slug"))
				if lerr != nil {
					return BuiltAsset{}, lerr
				}
				return BuiltAsset{
					PageID: live.Build.PageID, BuildID: live.Build.ID,
					AllowBYOAI: live.AllowBYOAI,
				}, nil
			},
			AssetPath: chi.URLParam(r, "*"),
			BaseHref:  fmt.Sprintf("/p/%s/", chi.URLParam(r, "slug")),
		})
	}
}

// pageHead —— what gets injected into <head> when serving index.html. Empty base =
// this isn't the root entry point this time (a sub-resource request), nothing gets
// injected.
type pageHead struct {
	base       string
	allowBYOAI bool
}

// tags —— the lines injected into <head>.
//
// The byoai line is **read fresh on every request**: if the owner flips off "bring
// your own key" on the panel, the next time this page opens it's the new value — no
// snapshot stored in the page, and no need for one more endpoint to ask. This is the
// other half of the same thing as sending no cache header (something taken down must
// stop taking effect immediately).
func (p pageHead) tags() string {
	return `<base href="` + html.EscapeString(p.base) + `">` +
		`<meta name="standmeet-page-byoai" content="` + strconv.FormatBool(p.allowBYOAI) + `">`
}

// resolveAsset / headFor / baseHrefFor / resolvedAsset used to live here — what they
// did now belongs to custom_page_serve.go (shared by both callers), leaving only
// "which build to look at" here.

// joinSafeAssetPath —— joins the owner-provided assetPath into a host file path,
// strictly checking the final path is still inside BuildsRoot. Backed by
// filepath.Clean + HasPrefix containment.
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

// writeHTMLWithBase —— streams index.html, and once it hits `<head>` inserts
// `<base href>`, so vite's ./assets/... always resolves against /p/<slug>/ as its base
// (a single-owner instance, so the URL carries no handle — F-L-44).
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

// injectHead —— injects <base> and this page's settings into <head>.
// html.EscapeString escapes any " < > & inside baseHref, preventing an attacker from
// using a malformed URL (e.g. a handle containing a quote) to inject extra attributes
// → XSS.
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

// contentTypeByExt —— a top-level map so contentTypeFor is a table lookup, keeping
// cyclo at 1.
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

// notFoundErrs —— a slice instead of a switch, keeping isNotFoundErr's cyclo at 2.
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
