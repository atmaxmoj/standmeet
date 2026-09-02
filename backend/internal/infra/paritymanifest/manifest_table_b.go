package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// connectors + external MCP servers.
func connectorsMCPServers() []Entry {
	browser := func(id, why string) fp.Op { return act(id, fp.Only(why, FacadeAdmin)) }
	return []Entry{
		// The 9 generic-registry ops (list / catalog / status / create / update / delete /
		// activate / disconnect / validate_spec) are now declared by **the connector axis
		// itself** (cmd/server/axisconn/ops.go) and projected onto faces via the convergence
		// point; mail_test_send belongs to the smtp connector's own manifest. This table no
		// longer has rows for them.
		//
		// The remaining four are browser-only (OAuth redirect, plaintext credential form):
		// they were always admin-only.
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
		// conversations — all three ops moved into the outbound convergence point
		// (dispatcher.Conversations).
	}
}

// owner settings (page / appearance / seo / handle / url / ai / byoai).
func settingsEntries() []Entry {
	// page / handle / public-url all moved into the outbound convergence point (dispatcher.Page).
	return []Entry{}
}
