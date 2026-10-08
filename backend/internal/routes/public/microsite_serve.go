// microsite_serve.go —— serves one build's output, the piece shared by both callers.
//
// Two callers, **differing only in which build they look at**:
//   - `/p/{slug}`                          → the live build, open to anyone
//   - `/microsites/{slug}/preview/{tok}` → the most recent successful build, gated by
//     token
//
// Pulled out because the section below carries **path-escape validation**
// (joinSafeAssetPath). Copy a second version and sooner or later only one side gets
// patched — and the unpatched side is the one that can read files outside BuildsRoot.
//
// **This file knows nothing about domains**: all it needs is three values (which page,
// which build, whether to bring its own key), computed and handed in by the caller.
// Knowing about a domain would mean bypassing the outbound convergence point to reach a
// domain directly (`check-routes-via-dispatcher`), and it has no need to anyway — it's a
// file server.

package public

import (
	"log/slog"
	"net/http"
)

// BuiltAsset —— which build's output is being served, plus the page settings injected into <head>.
type BuiltAsset struct {
	SeoTitle       *string
	SeoDescription *string
	SeoImage       *string
	PageID         string
	BuildID        string
	// Slug —— the live page's slug, injected as the standmeet-microsite meta so the SDK can name
	// the page a chat turn is asked on (the agent then reads that page's published text). Empty for
	// the admin preview: a draft is not what the agent reads.
	Slug string
	// PublicChat — the public tier's state (PublicChatOn / Spent / Off); injected into <head> so
	// the codeless AgentWidget picks inline, the visitor's own key, or the /gate handoff.
	PublicChat string
	// Canonical, PersonLD —— the page's own address and (homepage) the owner as a schema.org
	// Person; see microsite_identity.go. Empty for the admin preview.
	Canonical  string
	PersonLD   string
	AllowBYOAI bool
	// PublicSearch —— corpus.retrieval's public_search flag for the sole owner, injected into
	// <head> so the codeless corpus_search BlockWidget knows it may open a public session.
	PublicSearch bool
}

// BuildAssetReq —— everything needed to serve one build's asset.
type BuildAssetReq struct {
	Log *slog.Logger
	// Resolve —— **which build version to look at this time**. The only difference
	// between the two callers.
	Resolve    func() (BuiltAsset, error)
	BuildsRoot string
	// AssetPath —— the `*` segment of the URL (empty = root entry point, needs <base>
	// injected).
	AssetPath string
	// BaseHref —— the base injected into <head> at the root entry point. The browser
	// address has to match this path for vite's emitted `./assets/...` to resolve
	// correctly. **Must carry a trailing slash**: without it `./` resolves to the parent
	// directory, the path's last segment gets dropped, the script 404s, and the page
	// goes blank.
	BaseHref string
}

// micrositeCSP —— what a hosted page may never do: be framed by another site (clickjacking), embed
// plugin objects, or point <base> off this origin (the server injects one). Scripts, styles,
// images and connections stay open: the server injects an inline script, chat cards render in
// srcdoc iframes that inherit this policy, and the owner's page may load from anywhere
// (refactor ledger R20).
const micrositeCSP = "frame-ancestors 'self'; object-src 'none'; base-uri 'self'"

// ServeBuildAsset —— resolves the build → assembles a safe path → serves the file.
func ServeBuildAsset(w http.ResponseWriter, _ *http.Request, req *BuildAssetReq) {
	w.Header().Set("Content-Security-Policy", micrositeCSP)
	asset, err := req.Resolve()
	if err != nil {
		writeAssetErr(req.Log, w, err)
		return
	}
	fp, perr := joinSafeAssetPath(req.BuildsRoot, asset.PageID, asset.BuildID, req.AssetPath)
	if perr != nil {
		writeAssetErr(req.Log, w, perr)
		return
	}
	serveFile(req.Log, w, fp, &pageHead{
		base: baseOf(req), allowBYOAI: asset.AllowBYOAI,
		publicSearch: asset.PublicSearch, publicChat: asset.PublicChat, slug: asset.Slug,
		seoTitle: asset.SeoTitle, seoDescription: asset.SeoDescription, seoImage: asset.SeoImage,
		canonical: asset.Canonical, personLD: asset.PersonLD,
	})
}

// baseOf —— base is injected only at the root entry point; injecting it on a
// sub-resource request would bend the relative path one more layer than it should.
func baseOf(req *BuildAssetReq) string {
	if req.AssetPath != "" {
		return ""
	}
	return req.BaseHref
}
