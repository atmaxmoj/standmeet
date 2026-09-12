// blocks.go — admin facade for the owner's plugin screen. Two files became one: the
// block panel and a per-block config route were two views of one thing the
// owner calls "my plugins" (`frontend.md`). The connection half — credential form,
// OAuth dance, activate / disconnect — is in block_conn.go.
//
//	GET    /api/admin/blocks              → every block: origin, health, grant
//	PATCH  /api/admin/blocks/{id}         → {enabled} the owner's live off-switch
//	DELETE /api/admin/blocks/{id}         → only an owner-installed block can go
//	POST   /api/admin/blocks              → install one from a pasted manifest
//	GET    /api/admin/blocks/config       → which blocks have settable fields
//	GET    /api/admin/blocks/{id}/config  → declaration + current + default
//	PATCH  /api/admin/blocks/{id}/config  → write it back
//
// Two things stay deliberately separate here. **origin decides existence** (is it
// deletable), **enabled decides availability** (does a visitor session assemble it);
// both are decided at the convergence point, in one copy. And the off-switch is not a
// grant: `block-disable-while-attached` proves the switch bites a session already
// running, which a grant does not — collapsing the two loses the owner's only immediate
// remedy.
//
// **No block's name appears in this file.** The settings form is declared by the block's
// own manifest and rendered by type, which is what makes `frontend.md`'s acceptance test
// — adding a block costs no frontend code — reachable at all.

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/plugin/blockadmin"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// BlockAdminDeps — what the block routes need.
//
// Face — every op goes through the outbound convergence point. Svc serves only the
// browser-specific handful that never had an op: the OAuth redirect legs and the
// plaintext credential form (see block_conn.go), which belong to this facade alone.
type BlockAdminDeps struct {
	Face *dispatcher.Face
	Svc  *blockadmin.Service
}

// MountBlocks mounts the plugin screen's routes (caller prefix /api/admin).
func (h *Handlers) MountBlocks(r chi.Router) {
	face := h.BlocksAdmin.Face

	h.mountBlockPanel(r, face)

	r.Get("/blocks/{block_id}/config",
		h.dispatchOp(face, "block_config.get", urlParamArgs("block_id"), jsonOK))
	r.Patch("/blocks/{block_id}/config",
		h.dispatchOp(face, "block_config.set", bodyWithURLParam("block_id"), jsonOK))

	h.mountBundles(r, face)
}

// mountBlockPanel — the panel plus install / uninstall, one subrouter over one noun.
//
// `frontend.md`'s acceptance test is that adding a block costs no frontend code, and the
// POST here is what makes it true for the owner rather than only for us: without it,
// "install" means "ask someone to redeploy".
func (h *Handlers) mountBlockPanel(r chi.Router, face *dispatcher.Face) {
	r.Route("/blocks", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "blocks.list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "blocks.install", bodyArgs, jsonCreated))
		r.Patch("/{id}",
			h.dispatchOp(face, "blocks.set_enabled", bodyWithURLParam("id"), jsonOK))
		r.Delete("/{id}", h.dispatchOp(face, "blocks.delete", urlParamArgs("id"), jsonOK))
		// Every block's settings in one read. The screen lists blocks and their forms
		// together; per-block fetches would render the list in N round trips. Declared
		// before /{id} so chi does not read "config" as a block id.
		r.Get("/config", h.dispatchOp(face, "block_config.list", emptyArgs, jsonOK))
	})
}

// mountBundles — the assembler.
//
// Membership is addressed by the owner's own words — bundle name and block id — rather
// than by row ids the panel would have to carry. The names are what the owner sees on
// screen; making the URL say the same thing means a bug report can be read off the
// address bar.
func (h *Handlers) mountBundles(r chi.Router, face *dispatcher.Face) {
	r.Route("/bundles", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "bundles.list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "bundles.create", bodyArgs, jsonCreated))
		r.Delete("/{name}", h.dispatchOp(face, "bundles.delete", urlParamArgs("name"), jsonOK))
		r.Post("/{name}/blocks",
			h.dispatchOp(face, "bundles.add_block", bodyWithURLParam("name"), jsonOK))
		r.Delete("/{name}/blocks/{block_id}",
			h.dispatchOp(face, "bundles.remove_block",
				twoURLParams("name", "block_id"), jsonOK))
	})
}
