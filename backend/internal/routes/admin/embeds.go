// embeds.go — /api/admin/embeds/*: the owner's embed widget config (embed design
// 2026-09-01). An embed points at a code, and the origin allowlist lives on the embed.
// Everything is dispatched through the outbound convergence point's same dispatcher face.

package admin

import "github.com/go-chi/chi/v5"

// paramEmbedID — the URL path parameter name equals the op's input field name
// (mergeURLParams relies on this to align them).
const paramEmbedID = "embed_id"

// MountEmbeds mounts the /embeds subrouter (the caller is already inside the /embeds
// prefix).
//
// Reuses CodesAdmin.Face: every owner capability dispatches through **the same**
// dispatcher (wire.AdminFace(Dispatch)); this Face routes by op id, so "embeds.*" and
// "codes.*" go through the same convergence point. It doesn't get its own separate dep
// field because that would just be a second reference to the same value.
func (h *Handlers) MountEmbeds(r chi.Router) {
	face := h.CodesAdmin.Face
	r.Get("/", h.dispatchOp(face, "embeds.list", emptyArgs, jsonOK))
	r.Post("/", h.dispatchOp(face, "embeds.create", bodyArgs, jsonCreated))
	r.Patch("/{embed_id}",
		h.dispatchOp(face, "embeds.update", bodyWithURLParam(paramEmbedID), jsonOK))
	r.Delete("/{embed_id}",
		h.dispatchOp(face, "embeds.delete", urlParamArgs(paramEmbedID), jsonOK))
}
