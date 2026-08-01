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
		observabilityEntries(), customPageEntries(), apiKeyEntries(),
	)
}

func concat(groups ...[]Entry) []Entry {
	out := make([]Entry, 0, manifestCap)
	for _, g := range groups {
		out = append(out, g...)
	}
	return out
}

// session / keypairs —— account 本身已搬进出站收口(dispatcher.Account),
// 剩下的是浏览器会话生命周期和凭据引导面,它们本来就只在 admin 上。
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

// codes + per-code ACL —— 都搬进了出站收口(dispatcher.Codes)。
//
// 顺带补上了三条一直没被登记的 admin 路由(waypoints / corpus / ghost-evidence):
// 它们既没有 MCP 孪生,也没有台账行,棘轮从来看不见 —— 跟 /stats/graph 同一类。
func codesEntries() []Entry {
	return []Entry{}
}

// roles / prompts / skills 三组也都搬进了出站收口(dispatcher.{Roles,Prompts,Skills})。
// skills 连同 marketplace 一起 —— 它们共用"一个 skill 长什么样"这份形状。
// 这个函数现在是空的,等最后一批搬完连同整包一起删。
func rolesPromptsSkills() []Entry {
	return []Entry{}
}
