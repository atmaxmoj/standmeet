package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// connectors + external MCP servers.
func connectorsMCPServers() []Entry {
	browser := func(id, why string) fp.Op { return act(id, fp.Only(why, FacadeAdmin)) }
	return []Entry{
		// 通用注册表那 9 条(list / catalog / status / create / update / delete /
		// activate / disconnect / validate_spec)已经由**连接器轴自己声明**
		// (cmd/server/axisconn/ops.go),经收口投影到面上;mail_test_send 则归了
		// smtp 连接器自己的 manifest。这张表因此不再有它们的行。
		//
		// 剩下这四条是浏览器专属的(OAuth 跳转、明文凭据表单):它们本来就只在 admin 上。
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
