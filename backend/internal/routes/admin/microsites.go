// microsites.go — /api/admin/microsites: the owner's custom React pages.
//
// Read + **write**. The write group used to live only on MCP; the given exception was
// "the panel has no UI for this" — explaining the status quo with the status quo, and
// writing it somewhere the ratchet could read, so the gap stopped being reported from
// then on (see the comment in internal/owner/ops/microsites.go). Once the exception was
// removed, the convergence point names these eight routes by name at startup, and the
// server flatly refuses to boot until they're mounted.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape: create returns 201, everything else returns
// 200, the resource id goes in the path, everything else goes in the body.

package admin

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/buildnotify"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// MicrositesDeps — capability source for the admin microsites handlers.
type MicrositesDeps struct {
	Face *dispatcher.Face
	// Notifier backs the preview long-poll (/wait): it wakes the moment a build settles.
	Notifier *buildnotify.Notifier
}

// previewWaitTimeout — how long a preview long-poll is held before it returns the current
// version unchanged and the panel re-hangs. Well under the browser/proxy idle cutoff.
const previewWaitTimeout = 25 * time.Second

// MountMicrosites mounts the /microsites subrouter.
func (h *Handlers) MountMicrosites(r chi.Router) {
	face := h.MicrositesAdmin.Face
	r.Route("/microsites", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "microsite.list", emptyArgs, jsonOK))
		// wait — a UI-only long-poll (no MCP counterpart, so not a facade op): the preview
		// panel holds this open and is answered the instant a build settles, following the
		// agent's edits without a fixed poll interval.
		r.Get("/wait", h.micrositesWait())
		r.Post("/", h.dispatchOp(face, "microsite.create", bodyArgs, jsonCreated))
		// guide — the static frontend-authoring guide; same op on both faces (facade parity).
		r.Get("/guide", h.dispatchOp(face, "microsite.guide", emptyArgs, jsonOK))
		r.Get("/builds/{build_id}",
			h.dispatchOp(face, "microsite.get_build", urlParamArgs("build_id"), jsonOK))
		h.mountMicrositeItem(r, face)
	})
}

// micrositesWait — long-poll the preview state. The client passes the version it last
// saw (`?since=N`); this returns as soon as a build settles past it, or after
// previewWaitTimeout unchanged. The panel compares versions and refetches the list when it
// moved, then re-hangs — one held connection instead of a fixed poll interval.
func (h *Handlers) micrositesWait() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		version := h.awaitBuildChange(r, parseSince(r.URL.Query().Get("since")))
		writeJSON(h.Log, w, map[string]int64{"version": version})
	}
}

// awaitBuildChange — returns immediately with the current version when it already moved
// past `since`; otherwise blocks for the next build (or the timeout).
func (h *Handlers) awaitBuildChange(r *http.Request, since int64) int64 {
	cur, ch := h.MicrositesAdmin.Notifier.Current()
	if cur > since {
		return cur
	}
	return h.blockUntilSignal(r, ch, cur)
}

// blockUntilSignal — waits on the notifier channel, the request context, and the timeout.
// On a signal it re-reads the (now higher) version; on timeout/disconnect it returns the
// version it came in with (a disconnected write is harmless).
func (h *Handlers) blockUntilSignal(r *http.Request, ch <-chan struct{}, cur int64) int64 {
	ctx, cancel := context.WithTimeout(r.Context(), previewWaitTimeout)
	defer cancel()
	select {
	case <-ch:
		next, _ := h.MicrositesAdmin.Notifier.Current()
		return next
	case <-ctx.Done():
		return cur
	}
}

func parseSince(s string) int64 {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return int64(n)
}

// mountMicrositeItem — the /{slug} group. slug goes in the path, everything else goes in
// the body, the same shape as the skills facade.
func (h *Handlers) mountMicrositeItem(r chi.Router, face *dispatcher.Face) {
	r.Route("/{slug}", func(r chi.Router) {
		r.Get("/files", h.dispatchOp(face, "microsite.get_draft", urlParamArgs("slug"), jsonOK))
		r.Put("/files",
			h.dispatchOp(face, "microsite.write_file", bodyWithURLParam("slug"), jsonOK))
		r.Post("/build", h.dispatchOp(face, "microsite.build", urlParamArgs("slug"), jsonOK))
		r.Put("/byoai",
			h.dispatchOp(face, "microsite.set_byoai", bodyWithURLParam("slug"), jsonOK))
		r.Put("/store-writable",
			h.dispatchOp(face, "microsite.set_store_writable", bodyWithURLParam("slug"), jsonOK))
		r.Post("/staging",
			h.dispatchOp(face, "microsite.promote_to_staging", bodyWithURLParam("slug"), jsonOK))
		r.Post("/live",
			h.dispatchOp(face, "microsite.promote_to_live", bodyWithURLParam("slug"), jsonOK))
		r.Post("/rollback",
			h.dispatchOp(face, "microsite.rollback", urlParamArgs("slug"), jsonOK))
		r.Delete("/", h.dispatchOp(face, "microsite.delete", urlParamArgs("slug"), jsonOK))
	})
}
