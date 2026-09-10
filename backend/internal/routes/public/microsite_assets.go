// microsite_assets.go —— GET /api/v1/assets/{id}: serve an owner asset (a microsite embeds one via
// the SDK AssetWidget; corpus/reader content references others). A THIN pass-through: the backend
// reads the bytes from object storage over the INTERNAL network (minio:9000) and streams them, so
// the blob rides the instance's own HTTPS origin and minio is never exposed to the browser. This
// replaces a 302-redirect to a presigned minio URL, which required minio to be publicly reachable.
//
// Authorization is a two-branch permit, decided inside ServeAsset at the composition root (BEFORE
// any read), so this face stays a thin pass-through:
//   - public asset (a microsite references it) → served on a bare id: the page is public, and the
//     AssetWidget builds the URL client-side with no key to sign.
//   - gated asset (a corpus entry references it) → must carry a valid signature (from
//     usecase.SignAssetURL), which only an authorized render emits. Bare id + not public → 404,
//     so a leaked/guessed id never bypasses the entry's ACL (genre-assets-inherit.spec.ts:74).
//
// ServeAsset closes over the domain at the composition root (the face never touches a repo —
// check-routes-via-dispatcher); the query carries the signature it checks.

package public

import (
	"bytes"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

func (h *MicrositeHandlers) servePoolAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		blob, ok := h.ServeAsset(r.Context(), chi.URLParam(r, "id"), r.URL.Query())
		if !ok {
			http.NotFound(w, r)
			return
		}
		if blob.ContentType != "" {
			w.Header().Set("Content-Type", blob.ContentType)
		}
		w.Header().Set("Cache-Control", "private, max-age=60")
		// ServeContent writes the body (with Content-Length + range support) and keeps the
		// Content-Type we set; a zero modtime skips conditional-request handling.
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(blob.Data))
	}
}
