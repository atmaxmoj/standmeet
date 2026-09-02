// custom_page_preview.go —— lets the owner see what this page looks like from the panel.
//
//	GET /api/v1/custom-pages/{slug}/preview/{token}
//	GET /api/v1/custom-pages/{slug}/preview/{token}/*
//
// **Why this route exists**: `/p/{slug}` serves the **live** version. But these pages
// are actually written by Claude (the panel intro itself says "creates / builds /
// promotes via MCP"), so between the agent finishing a build and the owner giving the
// nod, there's a version the owner has nowhere to see — and that's exactly the version
// they want to see.
// The owner's own words: "let me have a panel to see the effect, so while I'm directing
// the agent to make changes I can watch it in real time."
//
// **Why a token instead of a session**: preview runs inside an iframe with
// `sandbox="allow-scripts"` (no allow-same-origin — otherwise a page the owner's AI
// wrote could reach the owner's admin session). A sandboxed opaque-origin iframe **sends
// no cookies on its sub-resources**: the document gets 200, its `<script>` gets 401, the
// page goes white. Observed in the logs: `/preview` → 200 441B,
// `/preview/assets/index-*.js` → 401 70B.
// So the credential travels in the **path** (not the query — a query on `<base href>`
// isn't inherited by relative paths).
//
// **This file knows nothing about domains**: both verifying the token and resolving the
// build are **functions injected in**, supplied by the composition root. A face
// reaching a domain directly bypasses the outbound convergence point
// (`check-routes-via-dispatcher`), and this layer only ever needed two answers anyway:
// "give me an ownerID" and "give me that build".

package public

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// CustomPagePreviewHandlers —— what preview needs. Both functions are injected by the
// composition root.
type CustomPagePreviewHandlers struct {
	Log *slog.Logger
	// VerifyToken —— if the token checks out, returns which owner it belongs to.
	// Returns an error if it doesn't.
	VerifyToken func(slug, token string) (string, error)
	// ResolveBuild —— this owner's most recent successful build of this page.
	ResolveBuild func(ctx context.Context, ownerID, slug string) (BuiltAsset, error)
	BuildsRoot   string
}

// Mount wires the two preview routes onto /api/v1.
func (h *CustomPagePreviewHandlers) Mount(r chi.Router) {
	r.Get("/custom-pages/{slug}/preview/{token}", h.previewAsset())
	r.Get("/custom-pages/{slug}/preview/{token}/*", h.previewAsset())
}

func (h *CustomPagePreviewHandlers) previewAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Preview is **never cached**: the owner opens it precisely to see the latest
		// version, and a cached preview would make it look like the agent did nothing.
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		slug, token := chi.URLParam(r, "slug"), chi.URLParam(r, "token")
		// ctx is taken **outside** the closure: calling r.Context() again inside the
		// closure would leave static analysis unable to see that it's being propagated
		// (contextcheck), and a human reader can't tell which moment's ctx is being
		// used either.
		ctx := r.Context()
		ServeBuildAsset(w, r, &BuildAssetReq{
			Log:        h.Log,
			BuildsRoot: h.BuildsRoot,
			Resolve:    func() (BuiltAsset, error) { return h.resolve(ctx, slug, token) },
			AssetPath:  chi.URLParam(r, "*"),
			BaseHref:   "/api/v1/custom-pages/" + slug + "/preview/" + token + "/",
		})
	}
}

// resolve —— verify the token → resolve the build. When the token is wrong, **it
// speaks as not-found** — it never tells someone holding a wrong token how close they
// are to the right shape.
func (h *CustomPagePreviewHandlers) resolve(
	ctx context.Context, slug, token string,
) (BuiltAsset, error) {
	ownerID, verr := h.VerifyToken(slug, token)
	if verr != nil {
		return BuiltAsset{}, verr
	}
	return h.ResolveBuild(ctx, ownerID, slug)
}
