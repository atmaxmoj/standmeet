// webhooks.go — /api/admin/webhooks/*: the owner's webhook endpoints, their delivery log, send
// test and re-deliver (docs/design/event-bus-outbox-webhooks.md, *Webhook endpoints*).
//
// Mounted from MountInstance on the same admin Face as the Tasks panel; the ability is webhooks.*.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// mountWebhooks mounts the /webhooks subrouter (from MountInstance, on its Face).
func (h *Handlers) mountWebhooks(r chi.Router, face *dispatcher.Face) {
	r.Route("/webhooks", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "webhooks.list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "webhooks.create", bodyArgs, jsonCreated))
		r.Get("/event_types", h.dispatchOp(face, "webhooks.event_types", emptyArgs, jsonOK))
		r.Patch("/{id}", h.dispatchOp(face, "webhooks.update", bodyWithURLParam("id"), jsonOK))
		r.Delete("/{id}", h.dispatchOp(face, "webhooks.delete", urlParamArgs("id"), jsonOK))
		r.Post("/{id}/rotate_secret",
			h.dispatchOp(face, "webhooks.rotate_secret", urlParamArgs("id"), jsonOK))
		r.Post("/{id}/test", h.dispatchOp(face, "webhooks.send_test", urlParamArgs("id"), jsonOK))
		r.Get("/{id}/deliveries",
			h.dispatchOp(face, "webhooks.deliveries", urlParamArgs("id"), jsonOK))
		r.Post("/{id}/redeliver",
			h.dispatchOp(face, "webhooks.redeliver", urlParamArgs("id"), jsonOK))
	})
}
