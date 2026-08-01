package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// connectors + external MCP servers.
func connectorsMCPServers() []Entry {
	browser := func(id, why string) fp.Op { return act(id, fp.Only(why, FacadeAdmin)) }
	return []Entry{
		{
			Op:    read("connectors.list", fp.OwnerRead()),
			MCP:   []string{"connectors.list"},
			Admin: []string{"GET /api/admin/connectors/"},
		},
		{
			Op:    read("connectors.catalog", fp.OwnerRead()),
			MCP:   []string{"connectors.catalog"},
			Admin: []string{"GET /api/admin/connectors/catalog"},
		},
		{
			Op:    read("connectors.status", fp.OwnerRead()),
			MCP:   []string{"connectors.status"},
			Admin: []string{"GET /api/admin/connectors/{id}/status"},
		},
		{
			Op:    act("connectors.create", fp.OwnerAction()),
			MCP:   []string{"connectors.create"},
			Admin: []string{"POST /api/admin/connectors/"},
		},
		{
			Op:    act("connectors.update", fp.OwnerAction()),
			MCP:   []string{"connectors.update"},
			Admin: []string{"PUT /api/admin/connectors/{id}"},
		},
		{
			Op:    act("connectors.delete", fp.OwnerAction()),
			MCP:   []string{"connectors.delete"},
			Admin: []string{"DELETE /api/admin/connectors/{id}"},
		},
		{
			Op:    act("connectors.activate", fp.OwnerAction()),
			MCP:   []string{"connectors.activate"},
			Admin: []string{"POST /api/admin/connectors/{id}/activate"},
		},
		{
			Op:    act("connectors.disconnect", fp.OwnerAction()),
			MCP:   []string{"connectors.disconnect"},
			Admin: []string{"POST /api/admin/connectors/{id}/disconnect"},
		},
		{
			Op:    browser("connectors.oauth_connect", "begins a browser OAuth redirect"),
			Admin: []string{"POST /api/admin/connectors/{id}/connect"},
		},
		{
			Op:    read("connectors.oauth_callback", fp.Only("provider→browser redirect target", FacadeAdmin)),
			Admin: []string{"GET /api/admin/connectors/{id}/callback"},
		},
		{
			Op:    act("connectors.save_credentials", fp.Only("accepts raw connector credentials", FacadeAdmin)),
			Admin: []string{"POST /api/admin/connectors/{id}/credentials"},
		},
		{
			Op:    read("connectors.credential_form", fp.Only("browser credential form schema", FacadeAdmin)),
			Admin: []string{"GET /api/admin/connectors/{id}/credential-form"},
		},
		{
			Op:    act("connectors.validate_spec", fp.OwnerAction()),
			MCP:   []string{"connectors.validate_spec"},
			Admin: []string{"POST /api/admin/connectors/validate-spec"},
		},
		{
			Op:    act("connectors.mail_test_send", fp.OwnerAction()),
			MCP:   []string{"connectors.mail_test_send"},
			Admin: []string{"POST /api/admin/connectors/mail/test-send"},
		},
	}
}

// writings / obsidian / conversations.
func contentEntries() []Entry {
	return []Entry{
		{
			Op:    act("writings.save", fp.OwnerAction()),
			MCP:   []string{"writing_create"},
			Admin: []string{"POST /api/admin/writings/", "PATCH /api/admin/writings/{id}"},
		},
		{
			Op:    read("obsidian.export", fp.Only("streams the vault as a zip download (browser file save)", FacadeAdmin)),
			Admin: []string{"GET /api/admin/obsidian/export"},
		},
		{
			Op:    act("obsidian.import", fp.Only("multipart vault upload; the sync connector's ingest surface", FacadeAdmin).Except(fp.Multipart)),
			Admin: []string{"POST /api/admin/obsidian/import"},
		},
		// conversations 三条都搬进了出站收口(dispatcher.Conversations)。
	}
}

// owner settings (page / appearance / seo / handle / url / ai / byoai).
func settingsEntries() []Entry {
	// page / handle / public-url 都搬进了出站收口(dispatcher.Page)。
	return []Entry{}
}
