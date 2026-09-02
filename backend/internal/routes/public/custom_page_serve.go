// custom_page_serve.go —— serves one build's output, the piece shared by both callers.
//
// Two callers, **differing only in which build they look at**:
//   - `/p/{slug}`                          → the live build, open to anyone
//   - `/custom-pages/{slug}/preview/{tok}` → the most recent successful build, gated by
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

// BuiltAsset —— which build's output is being served.
type BuiltAsset struct {
	PageID     string
	BuildID    string
	AllowBYOAI bool
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

// ServeBuildAsset —— resolves the build → assembles a safe path → serves the file.
func ServeBuildAsset(w http.ResponseWriter, _ *http.Request, req *BuildAssetReq) {
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
	serveFile(req.Log, w, fp, pageHead{base: baseOf(req), allowBYOAI: asset.AllowBYOAI})
}

// baseOf —— base is injected only at the root entry point; injecting it on a
// sub-resource request would bend the relative path one more layer than it should.
func baseOf(req *BuildAssetReq) string {
	if req.AssetPath != "" {
		return ""
	}
	return req.BaseHref
}
