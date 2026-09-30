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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"path/filepath"
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
	Deps   owner.MicrositeDeps
	Owners owner.SoleOwnerLookup
	Log    *slog.Logger
	// ServeAsset —— backs GET /api/v1/assets/{id} (see microsite_assets.go). The composition-root
	// closure decides authorization from the URL query (a valid signature on a gated corpus asset,
	// or a microsite reference for a public one), then reads the bytes over the internal net.
	// ok=false (unauthorized / unknown id / read fail) means 404; the face just streams the rest.
	ServeAsset func(ctx context.Context, id string, q url.Values) (AssetBlob, bool)
	// HomepageSEO —— the owner's site-root SEO (title / description / OG image), injected into the
	// homepage's <head> and winning over any `home` build's own page-row SEO. Decoupled from the
	// `home` microsite (owner-level), so it holds whether or not a home page is materialized/built.
	// Wired at the composition root (which may read the owner repo); nil = inject nothing. Returns
	// (title, description, image, err).
	HomepageSEO func(ctx context.Context) (string, string, string, error)
	// PublicSearch —— reads corpus.retrieval's public_search config for the sole owner, to be
	// injected into every served page's <head> (the codeless corpus_search BlockWidget reads it).
	// Wired at the composition root (which may read the block-config store); nil = never on. Read
	// fresh per request, so flipping the setting takes effect on the next page load.
	PublicSearch func(ctx context.Context) (bool, error)
	// PublicChat — the public tier's state: PublicChatOn (a provider with quota), PublicChatSpent
	// (a provider whose quota is gone) or PublicChatOff (none wired). Injected into <head> so the
	// codeless AgentWidget picks inline / the visitor's own key / the /gate handoff. Wired at the
	// composition root; nil = off. Read fresh per request.
	PublicChat func(ctx context.Context) (string, error)
	// CanOpen —— for a page closed to visitors without a code: does the request's owner session
	// or its visitor session token open it. Wired at the composition root; nil = nobody.
	CanOpen    func(r *http.Request, visitorToken, pageID string) bool
	BuildsRoot string
}

// The values of the standmeet-public-chat meta. "true" stays the usable state, so a page built
// before "spent" existed still reads it right.
const (
	PublicChatOn    = "true"
	PublicChatSpent = "spent"
	PublicChatOff   = "false"
)

// AssetBlob —— an asset's bytes + content type, read from storage for the thin serve route.
type AssetBlob struct {
	ContentType string
	Data        []byte
}

// Mount wires /microsites/{slug}/* onto /api/v1. The owner is a sole owner, so the
// URL carries no handle.
func (h *MicrositeHandlers) Mount(r chi.Router) {
	r.Get("/microsites", h.listLive())
	// A pool asset a microsite embeds (served same-origin; gated to microsite-referenced assets).
	r.Get("/assets/{id}", h.servePoolAsset())
	r.Get("/microsites/{slug}", h.serveAsset())
	r.Get("/microsites/{slug}/*", h.serveAsset())
	// homepage —— the reserved `home` page served at the site root (BaseHref "/"). The app
	// rewrites `/` here; 404 until an owner promotes a `home` page.
	r.Get("/homepage", h.serveHomepage())
	r.Get("/homepage/*", h.serveHomepage())
	// HEAD / —— link previewers and SEO tools ask HEAD first; chi's Get alone answered 405.
	r.Head("/homepage", h.serveHomepage())
	// The site root's SEO (title / description / OG image), read by the app's DefaultHome for its
	// <head> when no `home` build is live, and by the homepage editor to load current values.
	// Owner-level + public (it IS the public SEO), so it holds regardless of the `home` lifecycle.
	r.Get("/homepage-seo", h.serveHomepageSEO())
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
		h.serveSlugAt(w, r, slug, fmt.Sprintf("/p/%s/", slug), nil)
	}
}

// serveHomepage —— GET /api/v1/homepage[/*] —— serves the reserved `home` page at the site root
// (BaseHref "/"). The app rewrites `/` here. If no `home` page is live, ResolveLiveBuild returns
// not-found and this 404s — the app keeps its built-in homepage until an owner promotes one.
func (h *MicrositeHandlers) serveHomepage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.serveSlugAt(w, r, owner.HomepageSlug, "/", h.homepageSEOOverlay(r.Context()))
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
	w http.ResponseWriter, r *http.Request, slug, baseHref string, seoOverlay *pageSEO,
) {
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	ctx := r.Context()
	live, lerr := owner.ResolveOpenBuild(ctx, h.Deps, h.Owners, slug,
		func(pageID string) bool { return h.grantOpens(r, pageID) })
	if lerr != nil {
		h.writeServeErr(w, r, lerr)
		return
	}
	ServeBuildAsset(w, r, &BuildAssetReq{
		Log:        h.Log,
		BuildsRoot: h.BuildsRoot,
		Resolve: func() (BuiltAsset, error) {
			asset := BuiltAsset{
				PageID: live.Build.PageID, BuildID: live.Build.ID, Slug: slug,
				AllowBYOAI:   live.AllowBYOAI,
				PublicSearch: h.resolvePublicSearch(ctx),
				PublicChat:   h.resolvePublicChat(ctx),
				SeoTitle:     live.SeoTitle, SeoDescription: live.SeoDescription,
				SeoImage: live.SeoImage,
			}
			// The homepage's SEO is the owner's site-root SEO, which wins over whatever the `home`
			// build's own page row carried — the root's SEO lives on the owner, not the microsite.
			applySEOOverlay(&asset, seoOverlay)
			applyIdentity(&asset, &siteIdentity{
				ownerName: live.OwnerName, publicURL: live.PublicURL, slug: slug,
				home: slug == owner.HomepageSlug,
			})
			return asset, nil
		},
		AssetPath: chi.URLParam(r, "*"),
		BaseHref:  baseHref,
	})
}

// grantOpens —— does the request carry a grant for a page closed to visitors without a code: the
// owner's session, or a visitor session whose code is bound to the page. No CanOpen wired = none.
func (h *MicrositeHandlers) grantOpens(r *http.Request, pageID string) bool {
	if h.CanOpen == nil {
		return false
	}
	visitor, _ := visitorToken(r)
	return h.CanOpen(r, visitor, pageID)
}

// writeServeErr —— a closed page without a grant: the page itself sends the reader to enter a
// code; its sub-assets are simply not there (404, like every other resolve error).
//
// A reader who arrived WITH a code (`/p/<slug>?code=X`, the link a recruiter clicks) goes to
// the code link every other surface uses, `/?code=X`: it redeems the code, asks their name, and
// lands on the page the code opens. The bare /gate dropped the code and asked for it again.
func (h *MicrositeHandlers) writeServeErr(w http.ResponseWriter, r *http.Request, err error) {
	rel, _ := normalizeAssetRel(chi.URLParam(r, "*"))
	if errors.Is(err, owner.ErrMicrositeNeedsCode) && rel == "index.html" {
		http.Redirect(w, r, closedPageEntry(r), http.StatusFound)
		return
	}
	writeAssetErr(h.Log, w, err)
}

// closedPageEntry —— where a reader without a grant goes: the code link when they carry a code,
// else the gate.
func closedPageEntry(r *http.Request) string {
	if code := r.URL.Query().Get("code"); code != "" {
		return "/?code=" + url.QueryEscape(code)
	}
	return "/gate"
}

// resolvePublicSearch —— corpus.retrieval's public_search setting for the sole owner, or false.
// A read failure degrades to off (logged): a page whose config read hiccuped should refuse the
// codeless search, not silently open it — the safe default is the pre-feature behavior.
func (h *MicrositeHandlers) resolvePublicSearch(ctx context.Context) bool {
	if h.PublicSearch == nil {
		return false
	}
	on, err := h.PublicSearch(ctx)
	if err != nil {
		h.Log.Warn("resolve public_search", logErr, err)
		return false
	}
	return on
}

// resolvePublicChat —— the public tier's state, or off. Same fail-closed reasoning as
// resolvePublicSearch: a read hiccup should leave the codeless widget on the gate handoff (the
// pre-feature behavior), not silently open inline chat.
func (h *MicrositeHandlers) resolvePublicChat(ctx context.Context) string {
	if h.PublicChat == nil {
		return PublicChatOff
	}
	state, err := h.PublicChat(ctx)
	if err != nil {
		h.Log.Warn("resolve public_chat", logErr, err)
		return PublicChatOff
	}
	return state
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
	owner.ErrMicrositeNeedsCode,
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
