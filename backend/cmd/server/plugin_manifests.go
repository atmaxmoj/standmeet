// plugin_manifests.go —— 内建能力的**声明**(数据):id / 传输 / ACL / owner 面工具 / 配置字段 /
// 点了哪些 host op。宿主不 import 任何插件代码:契约只有这份 manifest + 运行时 MCP 协议。
//
// 从 plugins.go(注册机制)拆出来:那边是"怎么装",这边是"装什么"。B4 会把这几份挪到
// backend/capabilities/<id>/manifest.yaml,跟 backend/connectors/ 同形,那时这个文件就没了。

package main

import (
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// builtinManifests —— the built-in capability declarations, in ONE place. Registration and the
// facade-parity plugin-claim test both read this, so a manifest can never be verified against a
// stale copy (a test-only duplicate of setup data rots silently the moment the real one changes).
func builtinManifests() []mcpplugin.Manifest {
	return []mcpplugin.Manifest{
		askVisitorManifest(), summarizeManifest(), bookerManifest(), retrievalManifest(),
		mailSenderManifest(),
	}
}

// retrievalManifest —— corpus.retrieval 内建：静态二进制在 /srv/plugins/retrieval，经
// sandbox_stdio 在 bwrap 里跑。它要后端 corpus 数据（wiki/output/writing listers）→
// HostOps 按名字点单（宿主在 hostdesk 收口发单，socket 路径由 id 派生），插件断网经那
// 一根 socket 够到。per-session corpus-ACL scope（role snapshot 的 URI glob 白名单）经 tool-call
// `_meta` 携给插件、插件转进 socket 请求，host op 重建 AllowsCorpus。ACL=always（tool
// 恒暴露，scope 空则结果空，跟旧 in-process 行为一致）；tool 保 canonical 名
// corpus_search / corpus_read / corpus_list。
func retrievalManifest() mcpplugin.Manifest {
	return mcpplugin.Manifest{
		ID:           "corpus.retrieval",
		Title:        "Search the corpus",
		Version:      "1",
		Shape:        mcpplugin.ShapeVisitorOnly,
		ACL:          mcpplugin.ACLAlways,
		RawToolNames: true,
		Transport: mcpplugin.Transport{
			Kind:    mcpplugin.TransportSandboxStdio,
			Command: "/plugin/retrieval",
			Env: map[string]string{
				"RETRIEVAL_SOCKET": hostop.SocketPath("corpus.retrieval"),
			},
			Sandbox: &mcpplugin.Sandbox{
				PluginDir: "/srv/plugins/retrieval",
				HostOps: []string{
					"corpus_search", "corpus_read", "corpus_list",
					"corpus_links", "corpus_map", "corpus_resolve", "corpus_peek",
				},
			},
		},
	}
}

// mailSenderManifest —— mail.send 内建：访客向 owner 配的 mail 连接器发信。硬依赖 mail 品类槽
// （dep provider 名 "smtp"）connected → 未连经 global 单点闸隐藏。沙箱插件经 host socket 调
// MailContract.Send，落到 active mail 连接器（openapi SaaS / SMTP，插件不知 kind）。
func mailSenderManifest() mcpplugin.Manifest {
	return mcpplugin.Manifest{
		ID:           "mail.send",
		Title:        "Email the owner",
		Version:      "1",
		Shape:        mcpplugin.ShapeVisitorOnly,
		ACL:          mcpplugin.ACLRoleGranted,
		RawToolNames: true,
		Requires:     []string{"smtp"},
		Transport: mcpplugin.Transport{
			Kind:    mcpplugin.TransportSandboxStdio,
			Command: "/plugin/mail-sender",
			Env: map[string]string{
				"MAIL_SENDER_SOCKET": hostop.SocketPath("mail.send"),
			},
			Sandbox: &mcpplugin.Sandbox{
				PluginDir: "/srv/plugins/mail-sender",
				// 发信本身走连接器,读 owner 的名字/邮箱走 owner.meta。
				HostOps: []string{"connector.invoke", "owner.meta"},
			},
		},
	}
}

// bookerManifest —— calendar.book 内建：静态二进制在 /srv/plugins/booker，经
// sandbox_stdio 在 bwrap 里跑。它要后端数据（日历 connector / booking store / owner /
// 约成通知）→ HostOps 按名字点单（连接器 / 自己的存储 / 自己的配置 / owner.meta），插件
// 断网经那一根 socket 够到。ACL=role-granted（role 的 AllowedTools 含 calendar.book 才暴露）；
// 再叠一个 SessionGate（connector-connected + quota，composition root 经 NewBookerGate
// 注入）。tool 保 canonical 名 calendar_book / calendar_list_slots。卡片暂仍由前端
// 旧渲染器按 result wire 画（ui:// 迁移是 #134），故这里不声明 UI。
func bookerManifest() mcpplugin.Manifest {
	sock := hostop.SocketPath("calendar.book")
	return mcpplugin.Manifest{
		ID:      "calendar.book",
		Title:   "Book a meeting",
		Version: "1",
		// ShapeBoth —— booker 同时面向访客(calendar_book / list_slots)和 **owner**
		// (calendar.list_slots)。owner 侧工具声明在 OwnerTools 里,实现仍在沙箱:一份算法,
		// 不再host/沙箱各一份(策略评估 + slot 枚举曾经重复实现过两遍)。
		Shape:        mcpplugin.ShapeBoth,
		ACL:          mcpplugin.ACLRoleGranted,
		RawToolNames: true,
		OwnerTools:   bookerOwnerTools(),
		Config:       bookerConfigFields(),
		// 硬依赖 calendar connector：未连 → 经 global 单点闸隐藏（D-2，取代 booker
		// SessionGate 里的 Connected() 自查）。smtp 不在此 —— 确认信是软依赖，没连也能
		// book，只是 send_confirmation 那截不可用（per-tool，不 gate 整 cap）。
		Requires: []string{"calendar"},
		Transport: mcpplugin.Transport{
			Kind:    mcpplugin.TransportSandboxStdio,
			Command: "/plugin/booker",
			Env:     map[string]string{"BOOKER_SOCKET": sock},
			Sandbox: &mcpplugin.Sandbox{
				PluginDir: "/srv/plugins/booker",
				// 约一场会要:找 owner 的日历连接器、存自己那份预约记录、读自己的配置
				// (工作时段之类)、读 owner 的时区。
				HostOps: []string{
					"connector.invoke",
					"capstore.insert", "capstore.query", "capstore.count",
					"capstore.delete", "capstore.query_records", "capstore.delete_by_id",
					"capconfig.get", "owner.meta",
				},
			},
		},
	}
}

// bookerOwnerTools —— booker 的 owner 面声明(数据)。owner MCP 工具表在装配期枚举
// (facade-parity 照它对账),所以不能靠启动时 dial 沙箱;真被调用才 dial。入参跟沙箱工具一致。
func bookerOwnerTools() []mcpplugin.OwnerTool {
	return []mcpplugin.OwnerTool{{
		Name: "calendar.list_slots",
		Tool: "calendar_list_slots",
		Description: "Enumerate available [start, end] slots that pass booking policy " +
			"(weekday + working_hours + min_lead_days) AND don't overlap any FreeBusy " +
			"window. Returns up to 50 slots, RFC3339-formatted in UTC.",
		InputSchema: `{
			"type":"object",
			"properties":{
				"from_rfc3339":{"type":"string",
					"description":"Search window start (RFC3339)."},
				"until_rfc3339":{"type":"string",
					"description":"Search window end (RFC3339)."},
				"duration_min":{"type":"number",
					"description":"Slot length in minutes (e.g. 30, 60)."},
				"step_min":{"type":"number",
					"description":"Slot enumeration step in minutes (default 30)."}
			},
			"required":["from_rfc3339","until_rfc3339","duration_min"]
		}`,
	}, {
		Name: "bookings.list",
		Tool: "bookings_list",
		Description: "List the owner's confirmed bookings, newest first, each with " +
			"its booking id.",
		InputSchema: `{
			"type":"object",
			"properties":{
				"limit":{"type":"integer","description":"Max rows (default 50, max 200)."}
			}
		}`,
	}, {
		Name: "calendar.cancel_booking",
		Tool: "calendar_cancel_booking",
		Description: "Cancel one of the owner's bookings by its booking id: removes " +
			"the calendar event and the stored booking record.",
		InputSchema: `{
			"type":"object",
			"properties":{
				"booking_id":{"type":"string","description":"The booking record id."}
			},
			"required":["booking_id"]
		}`,
	}}
}

// summarizeManifest —— summarize 内建：静态二进制在 /srv/plugins/summarize，经
// sandbox_stdio 在 bwrap 里跑。它要后端数据（transcript/LLM/落库）→ HostOps 点了那三件
// 事（conversation.read / inference.generate / report.store）。tool 保 canonical
// 名 summarize_conversation；ACL=always（summarize 原对所有 mode 暴露）。
func summarizeManifest() mcpplugin.Manifest {
	sock := hostop.SocketPath("summarize_conversation")
	return mcpplugin.Manifest{
		ID:           "summarize_conversation",
		Title:        "Summarize the conversation",
		Version:      "1",
		Shape:        mcpplugin.ShapeVisitorOnly,
		ACL:          mcpplugin.ACLAlways,
		RawToolNames: true,
		Transport: mcpplugin.Transport{
			Kind:    mcpplugin.TransportSandboxStdio,
			Command: "/plugin/summarize",
			Env:     map[string]string{"SUMMARIZE_SOCKET": sock},
			Sandbox: &mcpplugin.Sandbox{
				PluginDir: "/srv/plugins/summarize",
				// 总结一次对话要:读逐字稿、借 owner 的模型生成、把报告交回来存。
				HostOps: []string{"conversation.read", "inference.generate", "report.store"},
			},
		},
	}
}

// askVisitorManifest —— ask_visitor 内建：静态二进制在 /srv/plugins/ask-visitor，经
// sandbox_stdio 在 bwrap 里跑（无后端数据依赖 → 一个 HostOp 都不点、完全断网）。ui:// 卡
// 现按 MCP Apps 挂在 tool `_meta.ui_resource` 上（不再在 manifest 声明）。
func askVisitorManifest() mcpplugin.Manifest {
	return mcpplugin.Manifest{
		// id/version 是写死的数据（跟 booker/retrieval/summarize 一致）——host 绝不
		// import 插件代码：契约只有 manifest + 运行时 MCP 协议，不是 Go 依赖。
		ID:           "ask_visitor",
		Title:        "Ask a question",
		Version:      "1",
		Shape:        mcpplugin.ShapeVisitorOnly,
		ACL:          mcpplugin.ACLAlways,
		RawToolNames: true,
		Transport: mcpplugin.Transport{
			Kind:    mcpplugin.TransportSandboxStdio,
			Command: "/plugin/ask-visitor",
			Sandbox: &mcpplugin.Sandbox{PluginDir: "/srv/plugins/ask-visitor"},
		},
	}
}

// bookerConfigFields —— booker 预约策略的**声明**。owner 面板按它通用渲染,值存进 booker
// 自己的隔离存储,沙箱经 capconfig.get 读回(默认值已兜好)。
//
// 这几个字段以前在 host 手写了一整套(entity 类型 + 默认值 + capstore 读写 + admin 路由 +
// 表单 + 一个 owner MCP 工具),沙箱里还有自己的一份 —— 两份已经飘了:host 说工作到 18:00、
// 缓冲 15 分钟,沙箱按 17:00、缓冲 0。取 host 那份(18:00 / 15):沙箱那份是**退化**的那一边
// —— 它连 buffer_min 都没设(=0),而面板、文档和 e2e 一直说 18:00 / 15。
// 也就是说访客过去在 17:00–18:00 之间订不上,而面板显示可以。**默认值现在只有这一处**。
func bookerConfigFields() []mcpplugin.ConfigField {
	return []mcpplugin.ConfigField{
		{
			Key: "working_hours_start", Label: "Working hours start",
			Type: mcpplugin.ConfigTypeTime, Default: `"09:00"`,
			Description: "Earliest time of day a visitor may book.",
		},
		{
			Key: "working_hours_end", Label: "Working hours end",
			Type: mcpplugin.ConfigTypeTime, Default: `"18:00"`,
			Description: "Latest time of day a visitor may book.",
		},
		{
			Key: "allowed_weekdays", Label: "Bookable weekdays",
			Type: mcpplugin.ConfigTypeStringList, Default: `["mon","tue","wed","thu","fri"]`,
			Description: "Three-letter lowercase weekdays that accept bookings.",
		},
		{
			Key: "min_lead_days", Label: "Minimum lead time (days)",
			Type: mcpplugin.ConfigTypeInt, Default: `2`,
			Min:         new(1),
			Description: "How far ahead a booking must be made.",
		},
		{
			Key: "buffer_min", Label: "Buffer between meetings (minutes)",
			Type: mcpplugin.ConfigTypeInt, Default: `15`,
			Min:         new(0),
			Description: "Gap kept clear either side of an existing event.",
		},
	}
}
