// corpus_crud.go — a single corpus entry's detail / update / delete / promote, with
// genre carried as a path parameter.
//
// Route table:
//   GET    /corpus/{genre}/{id}          — detail (including body and outbound/backlinks)
//   PATCH  /corpus/{genre}/{id}          — update
//   DELETE /corpus/{genre}/{id}          — delete (raw means archive; subjectivity also
//                                           goes through this route)
//   POST   /corpus/{genre}/{id}/promote  — promote one step (genre names the **source**)
//   POST   /corpus/{genre}/{id}/assets   — attach an asset (image / attachment / hero image)
//
// All capability is taken through the convergence point; this layer only carries the
// REST shape: delete returns 204 (the frontend is written against this contract),
// everything else returns 200.

package admin

import (
	"github.com/go-chi/chi/v5"
)

// MountCorpusCRUD — the four things you can do to a single corpus entry. create belongs to
// MountCorpus's POST /corpus/{genre}. The caller has already wrapped /api/admin.
func (h *Handlers) MountCorpusCRUD(r chi.Router) {
	face := h.Corpus.Face
	r.Get("/corpus/{genre}/{id}", h.dispatchOp(face, "corpus.get", corpusIDArgs, jsonOK))
	r.Patch("/corpus/{genre}/{id}",
		h.dispatchOp(face, "corpus.update", corpusEntryArgs, jsonOK))
	r.Delete("/corpus/{genre}/{id}",
		h.dispatchOp(face, "corpus.delete", corpusIDArgs, noContent))
	r.Post("/corpus/{genre}/{id}/promote",
		h.dispatchOp(face, "corpus.promote", corpusEntryArgs, jsonOK))
	// An asset attaches under a corpus entry, so its address nests under it too. Both
	// routes share one address: JSON hands over an https address (the server fetches it
	// itself — the owner-via-AI usage), multipart hands over bytes (the panel's file
	// picker). The split happens in corpus_assets.go.
	r.Post("/corpus/{genre}/{id}/assets", h.attachCorpusAsset())
	r.Delete("/corpus/{genre}/{id}/assets/{asset_id}",
		h.dispatchOp(face, "assets.delete", corpusAssetArgs, noContent))
}
