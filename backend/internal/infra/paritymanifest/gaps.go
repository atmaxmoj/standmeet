package paritymanifest

// KnownMCPGaps —— the paydown worklist: owner capabilities the admin API exposes that are NOT yet
// mirrored to the owner-MCP facade (per each op's declared Reach). This is NOT a list of
// intentional
// asymmetries — those are Only(...) in the manifest with a written reason. These are genuine gaps
// toward "the owner can drive everything from their AI client", tracked here so the conformance
// test
// (ownercore) can RATCHET them: MCPMissing(live) must equal this set exactly, so
// - a NEW admin route without an MCP twin → MCPMissing grows → test RED (no silent new drift),
// and
//   - filling a gap (adding the MCP tool) → delete its line here → test stays GREEN.
//
// The invariant: this list only ever SHRINKS. It is now EMPTY — every admin-exposed owner
// capability has an owner-MCP twin (facade parity fully paid down, 56→0). Any future admin route
// without an MCP twin will re-grow MCPMissing and turn the ratchet RED until it too is mirrored.
func KnownMCPGaps() []string {
	return []string{}
}

// KnownAPIGaps —— the api-facade paydown worklist: non-Agentic outward ops the api facade SHOULD
// render but doesn't yet (its renderer arrives in Wave D). Shrink-only, exactly like KnownMCPGaps:
// shipping an endpoint deletes its op-id; the ratchet (APIMissing == KnownAPIGaps) stays green.
// Agentic ops (ask / summarize / mail) are never here — they can't render on the brainless facade.
func KnownAPIGaps() []string {
	return []string{}
}
