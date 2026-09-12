package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// suppliers + external MCP servers.
func suppliersMCPServers() []Entry {
	browser := func(id, why string) fp.Op { return act(id, fp.Only(why, FacadeAdmin)) }
	return []Entry{
		// The 9 generic-registry ops (list / catalog / status / create / update / delete /
		// activate / disconnect / validate_spec) are declared by the composition root's
		// block wiring and projected onto faces via the convergence point, so this table
		// has no rows for them.
		//
		// The two below are different, and used to be missing. A block's own owner tools —
		// `suppliers.calendar_check` on google-calendar, `suppliers.mail_test_send` on
		// smtp — were exempt from this table while a supplier and a block were two
		// axes: their manifests were loaded by a different loader, so the guard that walks
		// declarations never saw them. One tree, one loader, and the exemption had nothing
		// left to stand on: the guard now sees every block's owner tools and demands a row
		// for each, which is what "the parity manifest is a complete source of truth rather
		// than a stale subset" was always supposed to mean.
		//
		// The remaining four are browser-only (OAuth redirect, plaintext credential form):
		// they were always admin-only.
		{
			Op: act("suppliers.calendar_check",
				fp.Only("owner asks whether the connected calendar still works", FacadeMCP)),
			MCP: []string{"suppliers.calendar_check"},
		},
		{
			Op: act("suppliers.mail_test_send",
				fp.Only("owner sends one test message through the active mail block", FacadeMCP)),
			MCP: []string{"suppliers.mail_test_send"},
		},
		{
			Op:    browser("suppliers.oauth_connect", "begins a browser OAuth redirect"),
			Admin: []string{"POST /api/admin/suppliers/{id}/connect"},
		},
		{
			Op:    read("suppliers.oauth_callback", fp.Only("provider→browser redirect target", FacadeAdmin)),
			Admin: []string{"GET /api/admin/suppliers/{id}/callback"},
		},
		{
			Op:    act("suppliers.save_credentials", fp.Only("accepts raw supplier credentials", FacadeAdmin)),
			Admin: []string{"POST /api/admin/suppliers/{id}/credentials"},
		},
		{
			Op:    read("suppliers.credential_form", fp.Only("browser credential form schema", FacadeAdmin)),
			Admin: []string{"GET /api/admin/suppliers/{id}/credential-form"},
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
			// The vault sync lives on both surfaces with different transports: the admin route takes
			// a multipart folder upload (a browser picker, a bespoke handler — not a dispatched op),
			// and the MCP op takes the files as a JSON array. Same SyncIngester underneath. The reach
			// is MCP-owned because only the MCP surface is a dispatched op; the admin multipart route
			// is declared below as its own bespoke surface.
			Op:    act("obsidian.import", fp.Only("admin twin is the multipart upload route", FacadeMCP)),
			MCP:   []string{"obsidian.import"},
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
