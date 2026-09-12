// session.go —— builds the trusted session context for data-backed builtin
// plugins (split out of mounted.go, to keep it under max-lines ≤350). sessionMetaFor
// is only handed to a builtin that declared HostSockets (passed in via tool-call `_meta`
// into its own sandbox, which then relays it to the host's narrow socket API); a third-party
// / socket-less plugin gets nil, to prevent leaks.

package mount

import (
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/infra/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// sessionMetaFor —— only a block that calls back to the host (the manifest declares a
// host op) gets a trusted session context. Not declared (ask_visitor / third-party) → nil.
func sessionMetaFor(m *plugin.Manifest, in *registry.AssembleInput) *mcpclient.SessionContext {
	if m.Transport.Sandbox == nil || len(m.Transport.Sandbox.HostOps) == 0 {
		return nil
	}
	return &mcpclient.SessionContext{
		OwnerID: in.OwnerID,
		// The subject is passed across the boundary whole (kind + id). The plugin records
		// it into whatever row it writes, and the host counts usage against that — if only
		// id were passed, two different paths' subjects would look identical in the same
		// field, and they must not be counted together (F-B-11).
		Subject:        mcpclient.Subject{Kind: string(in.Subject.Kind), ID: in.Subject.ID},
		ConversationID: in.ConversationID,
		Mode:           in.Mode,
		VisitorName:    in.Visitor.Name,
		VisitorEmail:   in.Visitor.Email,
		RoleID:         roleIDOf(in),
		CorpusScope:    corpusScopeOf(in),
		// This block's own per-role config (frozen in the snapshot). Only its own —
		// a plugin should never see the settings configured for a different block.
		BlockConfig: blockConfigOf(in, m.ID),
	}
}

// blockConfigOf —— on this session's role, **this one block's** config. No role / this
// block has no per-role config → nil (the sandbox side reads that as "never
// configured" and falls back to its own default).
//
// Picked out per-block rather than passing the whole table across: passing the whole
// table would let a third-party plugin read what the owner configured for a different
// block.
func blockConfigOf(in *registry.AssembleInput, blockID string) json.RawMessage {
	if in.RoleSnapshot == nil {
		return nil
	}
	return in.RoleSnapshot.BlockConfig()[blockID]
}

// roleIDOf —— the current session's role id. No role (public/byoai) → empty string.
func roleIDOf(in *registry.AssembleInput) string {
	if in.RoleSnapshot == nil {
		return ""
	}
	return in.RoleSnapshot.RoleID()
}

// corpusScopeOf —— the current session's frozen corpus-ACL scope, serialized across the
// boundary as **one whole block**.
//
// It is deliberately not split here into two lists, "what's granted / what's revoked": that
// would mean every new admission rule needs copying across four seams, and the one seam
// that gets missed wouldn't fail to compile (that's exactly how the first fix for F-D-7 lost
// published_only). No role → an empty scope (reaches nothing), not "the field is absent".
func corpusScopeOf(in *registry.AssembleInput) json.RawMessage {
	if in.RoleSnapshot == nil {
		return emptyCorpusScope()
	}
	raw, err := json.Marshal(in.RoleSnapshot.CorpusScope())
	if err != nil {
		return emptyCorpusScope()
	}
	return raw
}

func emptyCorpusScope() json.RawMessage {
	return json.RawMessage(`{"granted":[],"denied":[],"published_only":false}`)
}
