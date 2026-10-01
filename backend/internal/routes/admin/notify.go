// notify.go — /api/admin/notify/*: notification rules and the owner's linked IM chats
// (docs/design/notify-rules-and-live-transcript.md). The ability is notify.*.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// mountNotify mounts the /notify subrouter (from MountInstance, on its Face).
func (h *Handlers) mountNotify(r chi.Router, face *dispatcher.Face) {
	r.Route("/notify", func(r chi.Router) {
		r.Get("/rules", h.dispatchOp(face, "notify.rules", emptyArgs, jsonOK))
		r.Post("/rules", h.dispatchOp(face, "notify.create_rule", bodyArgs, jsonCreated))
		r.Patch("/rules/{id}",
			h.dispatchOp(face, "notify.set_rule_enabled", bodyWithURLParam("id"), jsonOK))
		r.Delete("/rules/{id}",
			h.dispatchOp(face, "notify.delete_rule", urlParamArgs("id"), jsonOK))
		r.Get("/event_types", h.dispatchOp(face, "notify.event_types", emptyArgs, jsonOK))
		r.Get("/im", h.dispatchOp(face, "notify.im_links", emptyArgs, jsonOK))
		r.Post("/im", h.dispatchOp(face, "notify.link_im", emptyArgs, jsonCreated))
		r.Delete("/im/{id}", h.dispatchOp(face, "notify.unlink_im", urlParamArgs("id"), jsonOK))
	})
}
