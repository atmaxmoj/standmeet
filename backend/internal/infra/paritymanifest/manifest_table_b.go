package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// connectors + external MCP servers.
func connectorsMCPServers() []Entry {
	browser := func(id, why string) fp.Op { return act(id, fp.Only(why, FacadeAdmin)) }
	return []Entry{
		{
			Op:    read("mcp_servers.list", fp.OwnerRead()),
			MCP:   []string{"mcp_server_list"},
			Admin: []string{"GET /api/admin/mcp-servers/"},
		},
		{
			Op:    act("mcp_servers.create", fp.OwnerAction()),
			MCP:   []string{"mcp_server_create"},
			Admin: []string{"POST /api/admin/mcp-servers/"},
		},
		{
			Op:    act("mcp_servers.delete", fp.OwnerAction()),
			MCP:   []string{"mcp_server_delete"},
			Admin: []string{"DELETE /api/admin/mcp-servers/{id}"},
		},
		{
			Op:    act("mcp_servers.grant_dep", fp.OwnerAction()),
			MCP:   []string{"mcp_server_grant_dep"},
			Admin: []string{"POST /api/admin/mcp-servers/{id}/dep-grants"},
		},
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
			Op:    read("writings.list", fp.OwnerRead()),
			MCP:   []string{"writing_list"},
			Admin: []string{"GET /api/admin/writings/"},
		},
		{
			Op:    act("writings.save", fp.OwnerAction()),
			MCP:   []string{"writing_create"},
			Admin: []string{"POST /api/admin/writings/", "PATCH /api/admin/writings/{id}"},
		},
		{
			Op:    act("writings.publish", fp.OwnerAction()),
			MCP:   []string{"writing_publish"},
			Admin: []string{"POST /api/admin/writings/{id}/publish"},
		},
		{
			Op:    act("writings.unpublish", fp.OwnerAction()),
			MCP:   []string{"writing_unpublish"},
			Admin: []string{"POST /api/admin/writings/{id}/unpublish"},
		},
		{
			Op:    act("writings.delete", fp.OwnerAction()),
			MCP:   []string{"writing_delete"},
			Admin: []string{"DELETE /api/admin/writings/{id}"},
		},
		{
			Op:    read("obsidian.export", fp.Only("streams the vault as a zip download (browser file save)", FacadeAdmin)),
			Admin: []string{"GET /api/admin/obsidian/export"},
		},
		{
			Op:    act("obsidian.import", fp.Only("multipart vault upload; the sync connector's ingest surface", FacadeAdmin).Except(fp.Multipart)),
			Admin: []string{"POST /api/admin/obsidian/import"},
		},
		{
			Op:    read("conversations.list", fp.OwnerRead()),
			MCP:   []string{"conversations.list"},
			Admin: []string{"GET /api/admin/conversations"},
		},
		{
			Op:    read("conversations.get", fp.OwnerRead()),
			MCP:   []string{"chat.show_grounding"},
			Admin: []string{"GET /api/admin/conversations/{id}"},
		},
		{
			Op:    read("conversations.ghost_telemetry", fp.OwnerRead()),
			MCP:   []string{"conversations.ghost_telemetry"},
			Admin: []string{"GET /api/admin/ghosts/telemetry"},
		},
	}
}

// owner settings (page / appearance / seo / handle / url / ai / byoai).
func settingsEntries() []Entry {
	return []Entry{
		{
			Op:    read("page.get", fp.OwnerRead()),
			MCP:   []string{"page.get"},
			Admin: []string{"GET /api/admin/page"},
		},
		{
			Op:    act("page.put", fp.OwnerAction()),
			MCP:   []string{"page.put"},
			Admin: []string{"PUT /api/admin/page"},
		},
		{
			// pin/unpin 是主页 insights/projects 的装填口(corpus pin 列表);
			// admin 面走同一条 PUT /page(pin 列表随整段内容保存)。
			Op:    act("page.pin", fp.OwnerAction()),
			MCP:   []string{"page.pin"},
			Admin: []string{"PUT /api/admin/page"},
		},
		{
			Op:    act("page.unpin", fp.OwnerAction()),
			MCP:   []string{"page.unpin"},
			Admin: []string{"PUT /api/admin/page"},
		},
		{
			Op:    act("page.set_handle", fp.OwnerAction()),
			MCP:   []string{"page.update_handle"},
			Admin: []string{"PATCH /api/admin/handle"},
		},
		{
			Op:    act("page.set_public_url", fp.OwnerAction()),
			MCP:   []string{"page.set_public_url"},
			Admin: []string{"PATCH /api/admin/public-url"},
		},
		{
			Op:    read("appearance.get_css", fp.OwnerRead()),
			MCP:   []string{"appearance.get_css"},
			Admin: []string{"GET /api/admin/appearance/css"},
		},
		{
			Op:    act("appearance.set_css", fp.OwnerAction()),
			MCP:   []string{"set_owner_css"},
			Admin: []string{"PUT /api/admin/appearance/css"},
		},
		{
			Op:    read("seo.get_settings", fp.OwnerRead()),
			MCP:   []string{"seo.get_settings"},
			Admin: []string{"GET /api/admin/seo"},
		},
		{
			Op:    act("seo.set_settings", fp.OwnerAction()),
			MCP:   []string{"seo.update_settings"},
			Admin: []string{"PUT /api/admin/seo"},
		},
		{
			Op:    read("seo.stats", fp.OwnerRead()),
			MCP:   []string{"seo.stats"},
			Admin: []string{"GET /api/admin/seo/stats"},
		},
		{
			Op:    act("ai_provider.set", fp.Only("sets a raw provider API key", FacadeAdmin)),
			Admin: []string{"PATCH /api/admin/ai-provider"},
		},
		{
			Op:    read("ai_provider.presets", fp.OwnerRead()),
			MCP:   []string{"ai_provider.presets"},
			Admin: []string{"GET /api/admin/ai-provider/presets"},
		},
		{
			Op:    act("byoai.set", fp.OwnerAction()),
			MCP:   []string{"byoai.set"},
			Admin: []string{"PUT /api/admin/byoai"},
		},
	}
}
