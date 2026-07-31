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
			// bookings.list 还留在 admin 上:约成的会是 booker 自己的数据,本该跟
			// calendar.list_slots 一样由沙箱出一个 OwnerTool。**卡在一个机制缺口**:
			// 列表要带记录 id(取消时按 id 找),而 reach-back 的固定词表里没有一个
			// 「查询并带回记录 id」的动词(只有 insert/query/count/delete)。
			// 补上那个动词之前,先如实记成单面,而不是假装它两个面都有。
			Op: read("bookings.list", fp.Only(
				"the capability's own records; moving it to the sandbox needs a capstore verb "+
					"that returns record ids — owed", FacadeAdmin)),
			Admin: []string{"GET /api/admin/bookings/"},
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
