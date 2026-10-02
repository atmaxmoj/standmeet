// session_context.go —— the trusted session identity a tool call carries to a built-in sandbox
// server on its `_meta` side channel. Split out of client.go (the 350-line cap): what the host
// says about the session, apart from how the client dials and calls.

package mcpclient

import "encoding/json"

// Subject —— the session's subject (kind + id). kind is a string, not an enum: this
// layer is a transport boundary that only carries the value from the layer above
// verbatim, and doesn't know how many kinds there are.
type Subject struct {
	Kind string
	ID   string
}

// SessionContext —— the trusted session identity the host passes to a built-in sandbox
// server, riding the tool-call's `_meta` side channel (not the LLM-controlled
// arguments). Typed (business code is barred from bare `any`); the conversion to a map
// is contained in this transport boundary layer. Third-party plugins pass nil → no
// session context.
type SessionContext struct {
	OwnerID string
	// FiberID —— the composition this session runs as; a storing block's schema is keyed by it
	// (rule 3). Host-derived, trusted like OwnerID (see docs/design/plugin/per-fiber-schema.md).
	FiberID string
	// Subject —— whose identity this session runs as (an access code / an outbound
	// key). Plugins record it into the rows they write, and the host counts usage
	// against it. This used to be called CodeID, so rows written on the key path had
	// no subject and quota had nothing to count against (F-B-11).
	Subject        Subject
	ConversationID string
	Mode           string
	VisitorName    string
	VisitorEmail   string
	RoleID         string
	// Page —— the microsite slug the turn is asked on ("" elsewhere).
	Page string
	// CorpusScope —— the session's frozen corpus-ACL scope, carried WHOLE so the externalized
	// retrieval plugin's host op can re-evaluate readability host-side without a role lookup.
	//
	// **One opaque blob on purpose.** It used to travel as two named string lists, hand-copied
	// at four seams (host writes _meta → plugin reads → plugin re-sends → host parses). When the
	// scope grew a third member — "this identity reads only what the owner published" — three of
	// those four seams still compiled and the field simply vanished in transit, denying a public
	// visitor everything (F-D-7's fix, caught by its own guard). The plugin has no business
	// knowing the shape of the host's ACL: it forwards these bytes untouched.
	CorpusScope json.RawMessage
	// BlockConfig —— this block's own per-role configuration, frozen into the role snapshot
	// at session start. Opaque here: the host carries the bytes and does not read a single key.
	//
	// This field replaced `NotifyOwnerOnBooking bool`. The comment on that one claimed the host
	// "neither sends it nor knows what booking notify means" while the field name — and a column
	// on the kernel's roles table — said the opposite. A block's settings now travel as the
	// block's own JSON, and only to that block.
	BlockConfig json.RawMessage
}

func (s *SessionContext) meta() map[string]any {
	if s == nil {
		return map[string]any{}
	}
	return map[string]any{"standmeet/session": map[string]any{
		"owner_id": s.OwnerID,
		"fiber_id": s.FiberID, // the composition; a storing block's host op keys its schema by it

		// subject_kind / subject_id —— the subject crosses the boundary as a whole
		// pair. **No longer sends `code_id`**: keeping it around would be a second
		// copy of the same fact, and a second copy sooner or later says something
		// different from the first (global CLAUDE.md rule 2).
		"subject_kind":    s.Subject.Kind,
		"subject_id":      s.Subject.ID,
		"conversation_id": s.ConversationID,
		"mode":            s.Mode,
		"visitor_name":    s.VisitorName,
		"visitor_email":   s.VisitorEmail,
		"role_id":         s.RoleID,
		// corpus_scope —— crosses the boundary as a whole blob, fields not split out
		// (see SessionContext.CorpusScope).
		"corpus_scope": s.CorpusScope,
		// block_config —— this block's own per-role config, passed through
		// untouched. The host doesn't know any of the keys inside it.
		"block_config": s.BlockConfig,
		// page —— the microsite the turn is asked on; a page-scoped block's host op acts on it.
		"page": s.Page,
	}}
}
