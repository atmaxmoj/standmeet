package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/facadeparity"

// apiKeyEntries —— owner-plane management of the API-key facade: mint/list/revoke/update keys, their
// per-key denials, and the candidacy ("open") toggles. MCP-first by product decision (the owner
// drives their instance from their AI client); the admin UI is a later wave, so each is Only(mcp)
// with that reason rather than an unreasoned admin gap. These manage the api facade; they do not
// live ON it (they are owner-plane, not outward).
func apiKeyEntries() []Entry {
	mcp := func(id string, read bool) Entry {
		reach := fp.Only("API-key facade management is MCP-first; admin UI is a later wave", FacadeMCP)
		op := act(id, reach)
		if read {
			op = readOp(id, reach)
		}
		return Entry{Op: op, MCP: []string{id}}
	}
	return []Entry{
		mcp("api_keys.create", false),
		mcp("api_keys.list", true),
		mcp("api_keys.revoke", false),
		mcp("api_keys.update", false),
		mcp("api_keys.list_denials", true),
		mcp("api_keys.add_denial", false),
		mcp("api_keys.remove_denial", false),
		mcp("api.open", false),
		mcp("api.close", false),
		mcp("api.list_candidates", true),
	}
}

// readOp —— a Read-kind op with the given reach (local alias so apiKeyEntries can pick kind by flag
// without shadowing the package-level read helper's name).
func readOp(id string, r fp.Reach) fp.Op { return read(id, r) }
