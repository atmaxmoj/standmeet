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
		// ip_bans 和 domains 各三条不在这张表里了 —— 它们搬进了出站收口
		// (internal/routes/dispatcher)。收口里的 op,parity 由结构回答:MCP 面遍历收口生成、
		// admin 面只能经 Face 取能力、取用即登记,启动时 Conform() 拿 Reach 跟登记对。
		// 台账里再写一行是多余的重复声明。
		//
		// 这张表只剩「还没搬的」。它随迁移缩短,搬完就整包删掉。
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
			// Served by the **sandboxed booker** via manifest.OwnerTools, not by ownercore: the
			// policy evaluation + slot enumeration belong to the capability, and the host no
			// longer keeps a second copy of either.
			Op:     act("calendar.list_slots", fp.Only("agent-facing booking helper; owner drives it via MCP", FacadeMCP)),
			MCP:    []string{"calendar.list_slots"},
			Plugin: true,
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
