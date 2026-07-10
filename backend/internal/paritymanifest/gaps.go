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
// The invariant: this list only ever SHRINKS. ~half need a new ownercore capability + deps wiring;
// the rest are a binding on an existing capability over an already-present usecase.
func KnownMCPGaps() []string {
	return []string{
		"access_requests.approve", "access_requests.list", "access_requests.update",
		"account.set_full_name",
		"ai_provider.presets",
		"appearance.get_css",
		"booking.get_policy", "booking.set_policy", "bookings.list",
		"byoai.set",
		"capabilities.delete", "capabilities.list", "capabilities.set_enabled",
		"codes.add_denial", "codes.list", "codes.list_denials", "codes.list_members",
		"codes.remove_denial",
		"connectors.activate", "connectors.catalog", "connectors.create", "connectors.delete",
		"connectors.disconnect", "connectors.list", "connectors.mail_test_send",
		"connectors.status",
		"connectors.update", "connectors.validate_spec",
		"conversations.ghost_telemetry", "conversations.list",
		"corpus.get",
		"domains.add", "domains.list", "domains.remove",
		"ip_bans.add", "ip_bans.list", "ip_bans.remove",
		"marketplace.install", "marketplace.search",
		"mcp_servers.grant_dep",
		"page.get", "page.put", "page.set_public_url",
		"prompts.get", "prompts.update",
		"roles.get", "roles.update",
		"seo.get_settings", "seo.stats",
		"skills.set_enabled",
		"stats.activity", "stats.growth", "stats.inference_usage", "stats.jobs", "system.status",
	}
}
