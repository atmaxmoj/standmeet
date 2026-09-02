// instance.go — this instance's own observability facade (admin's six read-only routes).
//
//	GET /system            #101 system panel
//	GET /inference-usage   #106 billing panel
//	GET /stats/growth      Monitor: SystemPulse
//	GET /stats/graph       TopBar: corpus link constellation
//	GET /stats/activity    Monitor: ActivityTicker
//	GET /stats/jobs        Monitor: background jobs
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go).
// The paths are a historical shape (system and stats/* use different prefixes) and stay
// unchanged — the frontend is written against them; only where the capability comes from
// changes.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// InstanceAdminDeps — capability source for admin's observability facade.
type InstanceAdminDeps struct {
	Face *dispatcher.Face
}

// MountInstance mounts these six read-only routes.
func (h *Handlers) MountInstance(r chi.Router) {
	face := h.InstanceAdmin.Face
	r.Get("/system", h.dispatchOp(face, "instance.status", emptyArgs, jsonOK))
	r.Get("/inference-usage",
		h.dispatchOp(face, "instance.inference_usage", emptyArgs, jsonOK))
	r.Get("/stats/growth", h.dispatchOp(face, "instance.corpus_growth", emptyArgs, jsonOK))
	r.Get("/stats/graph",
		h.dispatchOp(face, "instance.corpus_graph", queryArgsRenamed(nil, "limit"), jsonOK))
	r.Get("/stats/activity", h.dispatchOp(face, "instance.activity", emptyArgs, jsonOK))
	r.Get("/stats/jobs", h.dispatchOp(face, "instance.jobs", emptyArgs, jsonOK))
	r.Get("/upgrade", h.dispatchOp(face, "instance.upgrade_check", emptyArgs, jsonOK))
	r.Post("/upgrade", h.dispatchOp(face, "instance.upgrade", emptyArgs, jsonOK))
}
