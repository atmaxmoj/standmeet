// conversations.go — /api/admin/conversations/* + /api/admin/ghosts/telemetry.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape: the list at /conversations, a single
// transcript at /conversations/{id}, telemetry at /ghosts/telemetry.
//
// Before the migration, each facade built its own copy of a transcript: this side had
// refs and the ghost log, MCP's side had the body of cited entries, and neither was a
// subset of the other. Now it's the same payload.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// ConversationsDeps — capability source for the admin conversations handlers.
type ConversationsDeps struct {
	Face *dispatcher.Face
}

// MountConversations mounts /conversations + the ghost telemetry route.
func (h *Handlers) MountConversations(r chi.Router) {
	face := h.Conversations.Face
	r.Get("/conversations", h.dispatchOp(face, "conversations.list",
		queryArgsRenamed(map[string]string{}, "limit"), jsonOK))
	r.Get("/conversations/{conversation_id}", h.dispatchOp(face, "conversations.get",
		urlParamArgs("conversation_id"), jsonOK))
	r.Get("/ghosts/telemetry", h.dispatchOp(face, "conversations.ghost_telemetry",
		emptyArgs, jsonOK))
}
