package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// governance (access-requests / ip-bans / domains / capabilities / bookings).
func governanceEntries() []Entry {
	return []Entry{
		{
			Op:    read("access_requests.list", fp.OwnerRead()),
			MCP:   []string{"access_requests.list"},
			Admin: []string{"GET /api/admin/access-requests"},
		},
		{
			Op:    act("access_requests.update", fp.OwnerAction()),
			MCP:   []string{"access_requests.update"},
			Admin: []string{"PATCH /api/admin/access-requests/{id}"},
		},
		{
			Op:    act("access_requests.approve", fp.OwnerAction()),
			MCP:   []string{"access_requests.approve"},
			Admin: []string{"POST /api/admin/access-requests/{id}/approve"},
		},
		{
			Op:    read("ip_bans.list", fp.OwnerRead()),
			MCP:   []string{"ip_bans.list"},
			Admin: []string{"GET /api/admin/ip-bans/"},
		},
		{
			Op:    act("ip_bans.add", fp.OwnerAction()),
			MCP:   []string{"ip_bans.add"},
			Admin: []string{"POST /api/admin/ip-bans/"},
		},
		{
			Op:    act("ip_bans.remove", fp.OwnerAction()),
			MCP:   []string{"ip_bans.remove"},
			Admin: []string{"DELETE /api/admin/ip-bans/{id}"},
		},
		{
			Op:    read("domains.list", fp.OwnerRead()),
			MCP:   []string{"domains.list"},
			Admin: []string{"GET /api/admin/allowed-domains"},
		},
		{
			Op:    act("domains.add", fp.OwnerAction()),
			MCP:   []string{"domains.add"},
			Admin: []string{"POST /api/admin/allowed-domains"},
		},
		{
			Op:    act("domains.remove", fp.OwnerAction()),
			MCP:   []string{"domains.remove"},
			Admin: []string{"DELETE /api/admin/allowed-domains/{domain}"},
		},
		{
			Op:    read("capabilities.list", fp.OwnerRead()),
			MCP:   []string{"capabilities.list"},
			Admin: []string{"GET /api/admin/capabilities/"},
		},
		{
			Op:    act("capabilities.set_enabled", fp.OwnerAction()),
			MCP:   []string{"capabilities.set_enabled"},
			Admin: []string{"PATCH /api/admin/capabilities/{id}"},
		},
		{
			Op:    act("capabilities.delete", fp.OwnerAction()),
			MCP:   []string{"capabilities.delete"},
			Admin: []string{"DELETE /api/admin/capabilities/{id}"},
		},
		{
			Op:    read("bookings.list", fp.OwnerRead()),
			MCP:   []string{"bookings.list"},
			Admin: []string{"GET /api/admin/bookings/"},
		},
		{
			Op:    read("booking.get_policy", fp.OwnerRead()),
			MCP:   []string{"booking.get_policy"},
			Admin: []string{"GET /api/admin/booking-policy"},
		},
		{
			Op:    act("booking.set_policy", fp.OwnerAction()),
			MCP:   []string{"booking.set_policy"},
			Admin: []string{"PATCH /api/admin/booking-policy"},
		},
		{
			Op:  act("calendar.list_slots", fp.Only("agent-facing booking helper; owner drives it via MCP", FacadeMCP)),
			MCP: []string{"calendar.list_slots"},
		},
		{
			Op:  act("calendar.cancel_booking", fp.Only("owner cancels via MCP; admin has the bookings list, not per-booking cancel", FacadeMCP)),
			MCP: []string{"calendar.cancel_booking"},
		},
	}
}

// observability + marketplace.
func observabilityEntries() []Entry {
	return []Entry{
		{
			Op:    read("system.status", fp.OwnerRead()),
			MCP:   []string{"instance.status"},
			Admin: []string{"GET /api/admin/system"},
		},
		{
			Op:    read("stats.inference_usage", fp.OwnerRead()),
			MCP:   []string{"instance.inference_usage"},
			Admin: []string{"GET /api/admin/inference-usage"},
		},
		{
			Op:    read("stats.growth", fp.OwnerRead()),
			MCP:   []string{"instance.corpus_growth"},
			Admin: []string{"GET /api/admin/stats/growth"},
		},
		{
			Op:    read("stats.activity", fp.OwnerRead()),
			MCP:   []string{"instance.activity"},
			Admin: []string{"GET /api/admin/stats/activity"},
		},
		{
			Op:    read("stats.jobs", fp.OwnerRead()),
			MCP:   []string{"instance.jobs"},
			Admin: []string{"GET /api/admin/stats/jobs"},
		},
		{
			Op:    read("marketplace.search", fp.OwnerRead()),
			MCP:   []string{"marketplace.search"},
			Admin: []string{"GET /api/admin/marketplace/search"},
		},
		{
			Op:    act("marketplace.install", fp.OwnerAction()),
			MCP:   []string{"marketplace.install"},
			Admin: []string{"POST /api/admin/marketplace/install"},
		},
	}
}

// custom pages (authoring is MCP-only by product decision; only the list is on admin).
func customPageEntries() []Entry {
	only := func(id string) fp.Op {
		return act(id, fp.Only("custom-page authoring is MCP-only by product decision (sandbox builder)", FacadeMCP))
	}
	return []Entry{
		{
			Op:    read("custom_page.list", fp.OwnerRead()),
			MCP:   []string{"custom_page.list"},
			Admin: []string{"GET /api/admin/custom-pages"},
		},
		{Op: only("custom_page.create"), MCP: []string{"custom_page.create"}},
		{Op: only("custom_page.write_file"), MCP: []string{"custom_page.write_file"}},
		{Op: only("custom_page.build"), MCP: []string{"custom_page.build"}},
		{Op: only("custom_page.get_build"), MCP: []string{"custom_page.get_build"}},
		{Op: only("custom_page.promote_to_staging"), MCP: []string{"custom_page.promote_to_staging"}},
		{Op: only("custom_page.promote_to_live"), MCP: []string{"custom_page.promote_to_live"}},
		{Op: only("custom_page.rollback"), MCP: []string{"custom_page.rollback"}},
		{Op: only("custom_page.delete"), MCP: []string{"custom_page.delete"}},
	}
}
