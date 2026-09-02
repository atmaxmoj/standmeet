// writings.go — admin /writings: list / create / edit / publish / delete.
//
// Create and edit accept multipart: form field "data" is JSON, form field
// `file:<pending-id>` is an inline image's bytes, and the body's placeholder is
// `standmeet-asset:pending-<id>`.
//
// **These two used to connect straight to the domain** (calling corpus.SaveWriting
// itself, assembling the view itself), because the convergence point had no channel for
// carrying bytes. Once that channel was built, they became like every other route: the
// shape is still hand-written as before (how to unpack multipart, which status code),
// capability is taken through the Face — the bytes ride along with this call (see
// dispatcher.WithFiles), and the op side merges them with the address list MCP supplies.
//
// The tree and page routes still connect directly (writings_tree.go): they're views
// unique to the panel with no corresponding op.

package admin

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// WritingsAdminDeps is defined in writings_tree.go — its one remaining domain
// dependency (resolving asset addresses) only serves the tree / page view routes, so it
// lives alongside them; the save route no longer touches the domain at all.

// opWritingSave — create and edit are **the same op**: giving a writing_id means edit.
const opWritingSave = "writing_create"

// MountWritings mounts the /writings subrouter.
func (h *Handlers) MountWritings(r chi.Router) {
	face := h.WritingsAdmin.Face
	save := h.saveWritingViaFace(face)
	r.Route("/writings", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "writings.list", emptyArgs, jsonOK))
		r.Get("/tree", h.treeWritings())
		r.Get("/page", h.pageWritings())
		r.Post("/", save(http.StatusCreated, ""))
		r.Patch("/{id}", save(http.StatusOK, "id"))
		r.Post("/{writing_id}/publish",
			h.dispatchOp(face, "writings.publish", urlParamArgs("writing_id"), jsonOK))
		r.Post("/{writing_id}/unpublish",
			h.dispatchOp(face, "writings.unpublish", urlParamArgs("writing_id"), jsonOK))
		r.Delete("/{writing_id}",
			h.dispatchOp(face, "writings.delete", urlParamArgs("writing_id"), noContent))
	})
}

// saveWritingViaFace — create / edit share one handler. An empty idParam means create
// (no id in the URL).
//
// The op is taken at assembly time: if this facade can't carry bytes, it panics
// immediately, rather than waiting until the owner clicks save to return a 404.
func (h *Handlers) saveWritingViaFace(
	face *dispatcher.Face,
) func(status int, idParam string) http.HandlerFunc {
	op := face.MustOpFiles(opWritingSave)
	invoke := op.Invoke
	return func(status int, idParam string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			h.runWritingSave(w, r, &writingSaveCall{
				Invoke: invoke, Status: status, IDParam: idParam,
			})
		}
	}
}

// writingSaveCall — the three things one save needs (dodges argument-limit).
type writingSaveCall struct {
	Invoke  dispatcher.Invoke
	IDParam string
	Status  int
}

func (h *Handlers) runWritingSave(
	w http.ResponseWriter, r *http.Request, call *writingSaveCall,
) {
	parsed, perr := readWritingSave(w, r, call.IDParam)
	if perr != nil {
		writeError(h.Log, w, envBadReq(perr.Error()))
		return
	}
	// The bytes ride along: the op side matches them to the body's placeholder by the
	// field name `file:<pending-id>`.
	ctx := dispatcher.WithFiles(r.Context(), parsed.Files)
	out, err := call.Invoke(ctx, middleware.OwnerIDFrom(r.Context()), parsed.Data)
	if err != nil {
		h.writeOpError(w, opWritingSave, err)
		return
	}
	writeStatusBody(h.Log, w, call.Status, out)
}

// readWritingSave unpacks the envelope + fills the URL's id into the args. The returned
// Data is exactly what goes to the op.
func readWritingSave(
	w http.ResponseWriter, r *http.Request, idParam string,
) (parsedMultipart, error) {
	parsed, perr := parseWritingMultipart(w, r)
	if perr != nil {
		return parsedMultipart{}, perr
	}
	args, aerr := writingSaveArgs(parsed.Data, writingIDFrom(r, idParam))
	if aerr != nil {
		return parsedMultipart{}, aerr
	}
	parsed.Data = args
	return parsed, nil
}

// writingIDFrom — on edit the id is in the URL (PATCH /writings/{id}); on create there's
// none.
func writingIDFrom(r *http.Request, param string) string {
	if param == "" {
		return ""
	}
	return chi.URLParam(r, param)
}
