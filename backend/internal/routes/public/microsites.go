// microsites.go —— when a visitor hits /p/<slug>, app middleware reverse-proxies it
// to GET /api/v1/microsites/{slug}/{*path}. This file is responsible for reading the
// file back from the shared /srv/microsites/<page_id>/<build_id>/dist/* tree.
//
// Security: assetPath must not contain ..; the joined path is filepath.Clean'd and then
// strictly checked to still be under the BuildsRoot subtree; only a build that is both
// built and live is served.
//
// This layer stays at cyclo ≤ 3: the sole-owner→build chain lives in usecases, file
// resolution is split into a helper, content-type is a map lookup.

package public

import (
	"encoding/json"
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

// MicrositeHandlers —— dependencies for the visitor microsite asset route.
type MicrositeHandlers struct {
	Deps       owner.MicrositeDeps
	Owners     owner.SoleOwnerLookup
	Log        *slog.Logger
	BuildsRoot string
}

// Mount wires /microsites/{slug}/* onto /api/v1. The owner is a sole owner, so the
// URL carries no handle.
func (h *MicrositeHandlers) Mount(r chi.Router) {
	r.Get("/microsites", h.listLive())
	r.Get("/microsites/{slug}", h.serveAsset())
	r.Get("/microsites/{slug}/*", h.serveAsset())
	// homepage —— the reserved `home` page served at the site root (BaseHref "/"). The app
	// rewrites `/` here; 404 until an owner promotes a `home` page.
	r.Get("/homepage", h.serveHomepage())
	r.Get("/homepage/*", h.serveHomepage())
}

// pageLinkView —— one published page in the public listing: only what a link needs.
type pageLinkView struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

type micrositesListResponse struct {
	Pages []pageLinkView `json:"pages"`
}

// listLive —— GET /api/v1/microsites: the sole owner's published microsites (slug +
// title) so a visitor can discover them from the index / gate / reader. Anonymous; an
// unclaimed instance or a load error yields an empty list (logged), never a 500 that would
// break the surfaces embedding it — the same "a public read never hard-fails" rule the
// wiki-tree endpoints follow.
func (h *MicrositeHandlers) listLive() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		links, err := owner.LiveMicrosites(r.Context(), h.Deps, h.Owners)
		if err != nil {
			h.Log.Error("list live microsites", logErr, err)
		}
		resp := micrositesListResponse{Pages: toPageLinkViews(links)}
		if encErr := json.NewEncoder(w).Encode(resp); encErr != nil {
			h.Log.Warn("encode microsites list", logErr, encErr)
		}
	}
}

func toPageLinkViews(links []owner.LivePageLink) []pageLinkView {
	views := make([]pageLinkView, 0, len(links))
	for i := range links {
		views = append(views, pageLinkView{Slug: links[i].Slug, Title: links[i].Title})
	}
	return views
}

func (h *MicrositeHandlers) serveAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		h.serveSlugAt(w, r, slug, fmt.Sprintf("/p/%s/", slug))
	}
}

// serveHomepage —— GET /api/v1/homepage[/*] —— serves the reserved `home` page at the site root
// (BaseHref "/"). The app rewrites `/` here. If no `home` page is live, ResolveLiveBuild returns
// not-found and this 404s — the app keeps its built-in homepage until an owner promotes one.
func (h *MicrositeHandlers) serveHomepage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.serveSlugAt(w, r, owner.HomepageSlug, "/")
	}
}

// serveSlugAt —— the shared serve core for both a /p/<slug> page and the fixed-path homepage:
// they differ only in which slug to resolve and which <base href> to inject.
//
// **Must never be treated as a snapshot.** Once the owner takes it down (rollback / delete),
// this address should stop serving; the route used to send no Cache-Control header at all —
// with no header, the browser caches it by heuristic on its own, so a taken-down page kept
// opening fine. That isn't "the browser caching it on its own", it's us never having said not
// to. The only thing that should fall outside our control is a copy a reader already saved.
//
// The file-serving part is shared with the admin preview (microsite_serve.go) — they differ
// only in which build to look at, and path-escape validation must only ever exist once.
func (h *MicrositeHandlers) serveSlugAt(
	w http.ResponseWriter, r *http.Request, slug, baseHref string,
) {
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	ctx := r.Context()
	ServeBuildAsset(w, r, &BuildAssetReq{
		Log:        h.Log,
		BuildsRoot: h.BuildsRoot,
		Resolve: func() (BuiltAsset, error) {
			live, lerr := owner.ResolveLiveBuild(ctx, h.Deps, h.Owners, slug)
			if lerr != nil {
				return BuiltAsset{}, lerr
			}
			return BuiltAsset{
				PageID: live.Build.PageID, BuildID: live.Build.ID,
				AllowBYOAI: live.AllowBYOAI,
			}, nil
		},
		AssetPath: chi.URLParam(r, "*"),
		BaseHref:  baseHref,
	})
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
// did now belongs to microsite_serve.go (shared by both callers), leaving only
// "which build to look at" here.

// joinSafeAssetPath —— joins the owner-provided assetPath into a host file path,
// strictly checking the final path is still inside BuildsRoot. Backed by
// filepath.Clean + HasPrefix containment.
func joinSafeAssetPath(root, pageID, buildID, assetPath string) (string, error) {
	cleaned, ok := normalizeAssetRel(assetPath)
	if !ok {
		return "", owner.ErrMicrositeNotFound
	}
	buildRoot := filepath.Join(root, pageID, buildID, "dist")
	target := filepath.Join(buildRoot, cleaned)
	if !insideRoot(target, buildRoot) {
		return "", owner.ErrMicrositeNotFound
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
	owner.ErrMicrositeNotFound,
	owner.ErrOwnerNotFound,
	owner.ErrMicrositeBuildNotFound,
}

func isNotFoundErr(err error) bool {
	for _, target := range notFoundErrs {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}
