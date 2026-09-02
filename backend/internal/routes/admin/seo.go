// seo.go — /api/admin/seo/*: the facade this instance shows to search engines and share
// cards.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape: settings at /seo, counts at /seo/stats, a
// single entry through /corpus/{genre}/{id}/seo (genre and id in the path).
//
// Before the migration, two things had drifted: MCP's update_settings carried no
// site_title, and that upsert overwrote the whole row — changing robots once from Claude
// Code wiped out the site title the owner had written; also wiki / output had long been a
// single route on the panel side, but were still two separate tools on MCP's side.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// SEOAdminDeps — capability source for the admin SEO handlers.
type SEOAdminDeps struct {
	Face *dispatcher.Face
}

// MountSEO mounts /seo + /seo/stats + /corpus/{genre}/{id}/seo.
func (h *Handlers) MountSEO(r chi.Router) {
	face := h.SEOAdmin.Face
	r.Get("/seo", h.dispatchOp(face, "seo.get_settings", emptyArgs, jsonOK))
	r.Put("/seo", h.dispatchOp(face, "seo.update_settings", bodyArgs, jsonOK))
	r.Get("/seo/stats", h.dispatchOp(face, "seo.stats", emptyArgs, jsonOK))
	// Both genre and id sit in the path (the panel long ago folded wiki / output into
	// one route).
	r.Patch("/corpus/{genre}/{id}/seo",
		h.dispatchOp(face, "seo.set_entry_seo", bodyWithURLParam("genre", "id"), jsonOK))
}
