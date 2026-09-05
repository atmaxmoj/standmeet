package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// Manifest —— the canonical owner-capability set. One Entry per operation; MCP/Admin list the live
// primitives that realize it. Reach declares INTENT: OwnerAction/OwnerRead must be on both owner
// facades; Only(reason,…) is a written, single-surface decision. Where an OwnerAction/Read op names
// an MCP tool the registry doesn't yet expose, conformance is RED until that tool ships — that RED
// set is exactly the "fill the gap" worklist. Genuinely single-surface ops (raw secrets, browser
// OAuth, session plumbing, MCP-only page authoring) are Only(...) and stay conformant as-is.
func Manifest() []Entry {
	return concat(
		accountEntries(), corpusEntries(), codesEntries(), rolesPromptsSkills(),
		connectorsMCPServers(), contentEntries(), settingsEntries(), governanceEntries(),
		observabilityEntries(), micrositeEntries(), apiKeyEntries(),
	)
}

func concat(groups ...[]Entry) []Entry {
	out := make([]Entry, 0, manifestCap)
	for _, g := range groups {
		out = append(out, g...)
	}
	return out
}

// session / keypairs —— the account capability itself has moved into the outbound convergence
// point (dispatcher.Account); what's left is the browser session lifecycle and the credential
// bootstrap face, which were always admin-only.
func accountEntries() []Entry {
	return []Entry{
		{
			Op:    act("session.logout", fp.Only("browser session lifecycle, not a driveable capability", FacadeAdmin)),
			Admin: []string{"POST /api/admin/me/logout"},
		},
		{
			Op:    read("session.csrf", fp.Only("browser CSRF bootstrap, not a capability", FacadeAdmin)),
			Admin: []string{"GET /api/admin/csrf"},
		},
		{
			Op:    act("keypairs.create", fp.Only("issues a raw private key (Ed25519 PEM), shown once", FacadeAdmin)),
			Admin: []string{"POST /api/admin/keypairs/"},
		},
		{
			Op:    read("keypairs.list", fp.Only("credential bootstrap surface", FacadeAdmin)),
			Admin: []string{"GET /api/admin/keypairs/"},
		},
		{
			Op:    act("keypairs.delete", fp.Only("credential bootstrap surface", FacadeAdmin)),
			Admin: []string{"DELETE /api/admin/keypairs/{key_id}"},
		},
	}
}

// corpus —— all six ops (list / get / create / update / delete / promote) have moved into the
// corpus domain's own declaration (internal/corpus/ops); genre collapsed from "three tool sets"
// into a single parameter, and the facade reads it from the convergence point.
//
// This table used to record them as "one op, three MCP tools" (list_recent_raw / _wiki /
// _output), which was exactly the ledger doing bookkeeping the structure should own; now one op
// is one tool, and parity is guaranteed by dispatcher.Conform(). subjectivity.write moved out
// the same way, earlier.
func corpusEntries() []Entry {
	return []Entry{}
}

// codes + per-code ACL —— all moved into the outbound convergence point (dispatcher.Codes).
//
// Along the way it picked up three admin routes that had never been registered (waypoints /
// corpus / ghost-evidence): they have no MCP twin and no ledger row, so the ratchet never saw
// them — same category as /stats/graph.
func codesEntries() []Entry {
	return []Entry{}
}

// roles / prompts / skills —— all three groups have also moved into the outbound convergence
// point (dispatcher.{Roles,Prompts,Skills}). skills moved together with marketplace — they share
// the shape of "what a skill looks like". This function is empty now; it gets deleted along with
// the whole package once the last batch has moved.
func rolesPromptsSkills() []Entry {
	return []Entry{}
}
