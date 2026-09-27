// tasks.go — /api/admin/tasks/* and /api/admin/events/* — the Tasks panel.
//
// Mounted from MountInstance on the same admin Face: the job queue and the event stream are the
// instance's own machinery. The handler holds no runtime; every route takes its Op from the Face,
// so the panel and owner MCP run the same declaration.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

func (h *Handlers) mountTasks(r chi.Router, face *dispatcher.Face) {
	r.Route("/tasks", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "tasks.list",
			queryArgsRenamed(map[string]string{"kind": "kind", "state": "state"}, "limit"), jsonOK))
		r.Get("/overview", h.dispatchOp(face, "tasks.overview", queryArgs("kind"), jsonOK))
		r.Get("/periodic", h.dispatchOp(face, "tasks.periodic", emptyArgs, jsonOK))
		r.Post("/periodic/{name}/run",
			h.dispatchOp(face, "tasks.run_periodic", urlParamArgs("name"), jsonOK))
		r.Get("/{id}", h.dispatchOp(face, "tasks.get", urlParamArgs("id"), jsonOK))
		r.Post("/{id}/retry", h.dispatchOp(face, "tasks.retry", urlParamArgs("id"), jsonOK))
		r.Post("/{id}/cancel", h.dispatchOp(face, "tasks.cancel", urlParamArgs("id"), jsonOK))
	})
	r.Route("/events", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "events.list",
			queryArgsRenamed(map[string]string{"type": "type", "subject": "subject"}, "limit"),
			jsonOK))
		r.Get("/{id}", h.dispatchOp(face, "events.get", urlParamArgs("id"), jsonOK))
		r.Post("/{id}/requeue", h.dispatchOp(face, "events.requeue", urlParamArgs("id"), jsonOK))
	})
}
