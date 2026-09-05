// microsite_assets.go —— GET /api/v1/assets/{id}: serve a pool asset a microsite embeds (via the
// SDK AssetWidget). A microsite is a public page, so an asset it references is public too; the
// handler 302-redirects to the presigned blob.
//
// The ACL + presign live in ResolvePublicAsset, a closure wired at the composition root (the face
// never touches a repo — check-routes-via-dispatcher). It returns ok=false unless a microsite
// references the asset, so an asset used only by (possibly private) corpus entries returns 404 —
// indistinguishable from "doesn't exist", so the endpoint can't enumerate the owner's pool.

package public

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (h *MicrositeHandlers) servePoolAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		url, ok := h.ResolvePublicAsset(r.Context(), chi.URLParam(r, "id"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "private, max-age=60")
		http.Redirect(w, r, url, http.StatusFound)
	}
}
