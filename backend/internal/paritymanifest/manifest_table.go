package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/facadeparity"

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
		observabilityEntries(), customPageEntries(),
	)
}

func concat(groups ...[]Entry) []Entry {
	out := make([]Entry, 0, manifestCap)
	for _, g := range groups {
		out = append(out, g...)
	}
	return out
}

// account / session.
func accountEntries() []Entry {
	secret := func(id, why string) fp.Op { return act(id, fp.Only(why, FacadeAdmin)) }
	return []Entry{
		{
			Op:    read("account.me", fp.OwnerRead()),
			MCP:   []string{"me"},
			Admin: []string{"GET /api/admin/me"},
		},
		{
			Op:  act("account.set_full_name", fp.OwnerAction()),
			MCP: []string{"account.set_full_name"}, Admin: []string{"PATCH /api/admin/account/full-name"},
		},
		{
			Op:    secret("account.change_email", "verifies + changes the login email (current-password gated)"),
			Admin: []string{"PATCH /api/admin/account/email"},
		},
		{
			Op:    secret("account.change_password", "raw password; current-password gated"),
			Admin: []string{"PATCH /api/admin/account/password"},
		},
		{
			Op:    secret("account.generate_recovery", "mints a recovery secret"),
			Admin: []string{"POST /api/admin/account/recovery"},
		},
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

// corpus (raw/wiki/output/subjectivity).
func corpusEntries() []Entry {
	return []Entry{
		{
			Op:    read("corpus.list", fp.OwnerRead()),
			MCP:   []string{"list_recent_raw", "list_recent_wiki", "list_recent_output"},
			Admin: []string{"GET /api/admin/corpus/{genre}"},
		},
		{
			Op:  read("corpus.get", fp.OwnerRead()),
			MCP: []string{"corpus_get_entry"}, Admin: []string{"GET /api/admin/corpus/{genre}/{id}"},
		},
		{
			Op:  act("corpus.create", fp.OwnerAction()),
			MCP: []string{"raw_dump"}, Admin: []string{"POST /api/admin/corpus/{genre}"},
		},
		{
			Op:  act("corpus.update", fp.OwnerAction()),
			MCP: []string{"update_wiki", "update_output"}, Admin: []string{"PATCH /api/admin/corpus/{genre}/{id}"},
		},
		{
			Op:    act("corpus.delete", fp.OwnerAction()),
			MCP:   []string{"delete_wiki", "delete_output"},
			Admin: []string{"DELETE /api/admin/corpus/{genre}/{id}"},
		},
		{
			Op:    act("corpus.promote", fp.OwnerAction()),
			MCP:   []string{"promote_to_wiki", "promote_wiki_to_output"},
			Admin: []string{"POST /api/admin/corpus/{genre}/{id}/promote"},
		},
		{
			Op:    act("corpus.set_seo", fp.OwnerAction()),
			MCP:   []string{"seo.set_wiki_seo", "seo.set_output_seo"},
			Admin: []string{"PATCH /api/admin/corpus/{genre}/{id}/seo"},
		},
		{
			Op:  act("subjectivity.write", fp.Only("owner's private self-model; curated via MCP, no admin write form", FacadeMCP)),
			MCP: []string{"subjectivity_write"},
		},
	}
}

// codes + per-code ACL.
func codesEntries() []Entry {
	return []Entry{
		{
			Op:  read("codes.list", fp.OwnerRead()),
			MCP: []string{"codes.list"}, Admin: []string{"GET /api/admin/codes/"},
		},
		{
			Op:  act("codes.create", fp.OwnerAction()),
			MCP: []string{"codes.create"}, Admin: []string{"POST /api/admin/codes/"},
		},
		{
			Op:  act("codes.revoke", fp.OwnerAction()),
			MCP: []string{"codes.revoke"}, Admin: []string{"POST /api/admin/codes/{id}/revoke"},
		},
		{
			Op:  act("codes.update_quotas", fp.OwnerAction()),
			MCP: []string{"codes.update_quotas"}, Admin: []string{"PATCH /api/admin/codes/{id}/quotas"},
		},
		{
			Op:  read("codes.list_members", fp.OwnerRead()),
			MCP: []string{"codes.list_members"}, Admin: []string{"GET /api/admin/codes/{id}/members"},
		},
		{
			Op:  read("codes.list_denials", fp.OwnerRead()),
			MCP: []string{"codes.list_denials"}, Admin: []string{"GET /api/admin/codes/{id}/denials"},
		},
		{
			Op:  act("codes.add_denial", fp.OwnerAction()),
			MCP: []string{"codes.add_denial"}, Admin: []string{"POST /api/admin/codes/{id}/denials/{kind}"},
		},
		{
			Op:    act("codes.remove_denial", fp.OwnerAction()),
			MCP:   []string{"codes.remove_denial"},
			Admin: []string{"DELETE /api/admin/codes/{id}/denials/{kind}/{targetId}"},
		},
	}
}

// roles / prompts / skills.
func rolesPromptsSkills() []Entry {
	return []Entry{
		{
			Op:    read("roles.list", fp.OwnerRead()),
			MCP:   []string{"role_list"},
			Admin: []string{"GET /api/admin/roles/"},
		},
		{
			Op:    act("roles.create", fp.OwnerAction()),
			MCP:   []string{"role_create"},
			Admin: []string{"POST /api/admin/roles/"},
		},
		{
			Op:    read("roles.get", fp.OwnerRead()),
			MCP:   []string{"roles.get"},
			Admin: []string{"GET /api/admin/roles/{id}"},
		},
		{
			Op:    act("roles.update", fp.OwnerAction()),
			MCP:   []string{"role_update"},
			Admin: []string{"PUT /api/admin/roles/{id}"},
		},
		{
			Op:    act("roles.delete", fp.OwnerAction()),
			MCP:   []string{"role_delete"},
			Admin: []string{"DELETE /api/admin/roles/{id}"},
		},
		{
			Op:  act("roles.set_dock_buttons", fp.Only("chat-dock UI hint, folded into role update on admin", FacadeMCP)),
			MCP: []string{"roles.set_dock_buttons"},
		},
		{
			Op:    read("prompts.list", fp.OwnerRead()),
			MCP:   []string{"prompt_list"},
			Admin: []string{"GET /api/admin/prompts/"},
		},
		{
			Op:    act("prompts.create", fp.OwnerAction()),
			MCP:   []string{"prompt_create"},
			Admin: []string{"POST /api/admin/prompts/"},
		},
		{
			Op:    read("prompts.get", fp.OwnerRead()),
			MCP:   []string{"prompts.get"},
			Admin: []string{"GET /api/admin/prompts/{id}"},
		},
		{
			Op:    act("prompts.update", fp.OwnerAction()),
			MCP:   []string{"prompt_update"},
			Admin: []string{"PUT /api/admin/prompts/{id}"},
		},
		{
			Op:    act("prompts.delete", fp.OwnerAction()),
			MCP:   []string{"prompt_delete"},
			Admin: []string{"DELETE /api/admin/prompts/{id}"},
		},
		{
			Op:    read("skills.list", fp.OwnerRead()),
			MCP:   []string{"skill_list"},
			Admin: []string{"GET /api/admin/skills/"},
		},
		{
			Op:    act("skills.create", fp.OwnerAction()),
			MCP:   []string{"skill_create"},
			Admin: []string{"POST /api/admin/skills/"},
		},
		{
			Op:    act("skills.set_enabled", fp.OwnerAction()),
			MCP:   []string{"skill_set_enabled"},
			Admin: []string{"PATCH /api/admin/skills/{id}"},
		},
		{
			Op:    act("skills.delete", fp.OwnerAction()),
			MCP:   []string{"skill_delete"},
			Admin: []string{"DELETE /api/admin/skills/{id}"},
		},
	}
}
