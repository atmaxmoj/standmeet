// codes.go — /api/admin/codes/*: the invitation codes the owner has issued.
//
// Capability comes from the outbound convergence point (shared plumbing in dispatch.go);
// this facade only decides the REST shape: the resource id goes in the path, everything
// else goes in the body, and a denial's kind and target also sit in the path (a
// historical shape the frontend was written against).
//
// The outbound payload is the same one MCP's facade uses. Before the migration, three
// things had drifted:
//   - MCP's codes.list was missing require_ghost_evidence / prompt_id;
//   - corpus denial (the ACL's third kind) only had a separate route on admin; MCP's
//     list_denials couldn't see it;
//   - the waypoints / corpus / ghost-evidence routes had zero lines in the hand-written
//     ledger, so the ratchet couldn't see them.

package admin

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// Path parameter names — the frontend is written against this URL shape; renaming one
// means changing the frontend too.
const (
	paramCodeID   = "code_id"
	paramKind     = "kind"
	paramTargetID = "target_id"
)

// CodesDeps — capability source for the admin codes handlers.
type CodesDeps struct {
	Face *dispatcher.Face
}

// MountCodes mounts the /codes subrouter (the caller is already inside the /codes prefix).
func (h *Handlers) MountCodes(r chi.Router) {
	face := h.CodesAdmin.Face
	r.Get("/", h.dispatchOp(face, "codes.list", emptyArgs, jsonOK))
	r.Post("/", h.dispatchOp(face, "codes.create", bodyArgs, jsonCreated))
	r.Post("/{code_id}/revoke",
		h.dispatchOp(face, "codes.revoke", urlParamArgs(paramCodeID), jsonOK))
	r.Patch("/{code_id}/quotas",
		h.dispatchOp(face, "codes.update_quotas", bodyWithURLParam(paramCodeID), jsonOK))
	r.Patch("/{code_id}/ghost-evidence",
		h.dispatchOp(face, "codes.set_ghost_evidence", bodyWithURLParam(paramCodeID), jsonOK))
	// Which page this code opens. An empty slug unbinds it, falling back to the default
	// visitor chat.
	r.Patch("/{code_id}/microsite",
		h.dispatchOp(face, "codes.set_microsite", bodyWithURLParam(paramCodeID), jsonOK))
	r.Get("/{code_id}/members",
		h.dispatchOp(face, "codes.list_members", urlParamArgs(paramCodeID), jsonOK))
	h.mountCodeACL(r, face)
}

// mountCodeACL — a single code's ACL facade: the three denial kinds + waypoint
// destinations.
//
// The three denial kinds used to split across two places: capability/skill went through
// /denials/{kind}, corpus went through a separate /corpus. Now it's the same op with kind
// as a parameter — they were always three dimensions of "narrowing further within the
// scope a role already grants".
func (h *Handlers) mountCodeACL(r chi.Router, face *dispatcher.Face) {
	r.Get("/{code_id}/waypoints",
		h.dispatchOp(face, "codes.waypoints", urlParamArgs(paramCodeID), jsonOK))
	r.Put("/{code_id}/waypoints",
		h.dispatchOp(face, "codes.set_waypoints", bodyWithURLParam(paramCodeID), jsonOK))
	r.Get("/{code_id}/denials",
		h.dispatchOp(face, "codes.list_denials", urlParamArgs(paramCodeID), jsonOK))
	// Replaces a whole denial kind's set at once. Today only corpus is "a single list"
	// (the owner edits it in a textbox), so kind is fixed in the path here; the shape is
	// left in place for the other two kinds later.
	r.Put("/{code_id}/denials/corpus",
		h.dispatchOp(face, "codes.set_corpus_denials", bodyWithURLParam(paramCodeID), jsonOK))
	r.Post("/{code_id}/denials/{kind}",
		h.dispatchOp(face, "codes.add_denial", addDenialArgs, jsonCreated))
	r.Delete("/{code_id}/denials/{kind}/{target_id}",
		h.dispatchOp(face, "codes.remove_denial", pathDenialArgs, jsonOK))
}

// denialTargetFields — the body field name each kind uses (a historical shape: the field
// name varies with kind). The convergence point side is uniformly target_id; the mapping
// happens here — this is what "the REST shape stays in the facade" looks like concretely.
//
// kind itself is this route's own path segment, so it's a literal here; which values are
// accepted is decided by the op's schema — the facade doesn't restate that judgment
// (a wrong value gets a bad-input reply from the domain).
var denialTargetFields = map[string]string{
	"capability": "capability_id",
	"skill":      "skill_id",
	"corpus":     "uri",
}

// addDenialArgs — POST /codes/{id}/denials/{kind}: kind in the path, target in the body.
func addDenialArgs(r *http.Request) (json.RawMessage, error) {
	kind := chi.URLParam(r, paramKind)
	fields, err := decodeBodyFields(r)
	if err != nil {
		return nil, err
	}
	target, ok := fields[denialTargetFields[kind]]
	if !ok {
		return nil, dispatcher.BadInput(
			"body must carry " + denialTargetFields[kind] + " for kind " + kind,
		)
	}
	return marshalDenial(chi.URLParam(r, paramCodeID), kind, target)
}

// pathDenialArgs — DELETE /codes/{id}/denials/{kind}/{target_id}: all three sit in the path.
func pathDenialArgs(r *http.Request) (json.RawMessage, error) {
	target, merr := json.Marshal(chi.URLParam(r, paramTargetID))
	if merr != nil {
		return nil, dispatcher.BadInput("invalid path parameter")
	}
	return marshalDenial(chi.URLParam(r, paramCodeID), chi.URLParam(r, paramKind), target)
}

func marshalDenial(codeID, kind string, target json.RawMessage) (json.RawMessage, error) {
	out, err := json.Marshal(map[string]json.RawMessage{
		"code_id":   json.RawMessage(strconv.Quote(codeID)),
		"kind":      json.RawMessage(strconv.Quote(kind)),
		"target_id": target,
	})
	if err != nil {
		return nil, dispatcher.BadInput("invalid denial request")
	}
	return out, nil
}
