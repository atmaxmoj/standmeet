package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// governance (access-requests / ip-bans / domains / capabilities / bookings).
func governanceEntries() []Entry {
	return []Entry{
		// access_requests / ip_bans / domains 都不在这张表里了 —— 它们搬进了出站收口
		// (internal/routes/dispatcher)。收口里的 op,parity 由结构回答:MCP 面遍历收口生成、
		// admin 面只能经 Face 取能力、取用即登记,启动时 Conform() 拿 Reach 跟登记对。
		// 台账里再写一行是多余的重复声明。
		//
		// 这张表只剩「还没搬的」。它随迁移缩短,搬完就整包删掉。
		// booking 的**策略**不在这张表里了 —— 它是 booker 这个外置能力自己的配置,
		// 声明在 booker 的 manifest(Config),经通用的 capability_config 口读写。
		// host 不再认识 "booking policy",两个面也不再各有一份实现。
		{
			// 由**沙箱 booker** 经 OwnerTools 提供:约成的会是它自己的数据。
			// host 那条 admin REST 路由已退役 —— 它当时存在,只是因为沙箱拿不到自己记录的 id
			// (reach-back 词表里没有"查询并带回 id"),补上 capstore.query_records 之后就通了。
			Op:     read("bookings.list", fp.Only("the capability's own records", FacadeMCP)),
			MCP:    []string{"bookings.list"},
			Plugin: true,
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
			// 跟 list_slots 一样,由**沙箱 booker** 经 manifest.OwnerTools 提供:
			// 删日历事件 + 删自己那条记录都是 booker 的事,host 曾经又实现了一遍
			// (uc_booking_cancel*.go + ownercore 的 cap_calendar),现在那两份已删。
			Op:     act("calendar.cancel_booking", fp.Only("owner cancels via MCP; admin has the bookings list, not per-booking cancel", FacadeMCP)),
			MCP:    []string{"calendar.cancel_booking"},
			Plugin: true,
		},
	}
}

// observability + marketplace.
func observabilityEntries() []Entry {
	return []Entry{}
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
