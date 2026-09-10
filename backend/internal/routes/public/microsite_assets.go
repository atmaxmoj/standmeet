// microsite_assets.go —— GET /api/v1/assets/{id}: serve an owner asset (a microsite embeds one via
// the SDK AssetWidget; corpus/reader content references others). A THIN pass-through: the backend
// reads the bytes from object storage over the INTERNAL network (minio:9000) and streams them, so
// the blob rides the instance's own HTTPS origin and minio is never exposed to the browser. This
// replaces a 302-redirect to a presigned minio URL, which required minio to be publicly reachable.
//
// The read lives in ServeAsset, a closure wired at the composition root (the face never touches a
// repo — check-routes-via-dispatcher). Served by (unguessable) id; ok=false → a plain 404.

package public

import (
	"bytes"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

func (h *MicrositeHandlers) servePoolAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		blob, ok := h.ServeAsset(r.Context(), chi.URLParam(r, "id"))
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
