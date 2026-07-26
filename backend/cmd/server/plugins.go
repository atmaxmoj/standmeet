// plugins.go —— composition root: 把所有 MCP-app 能力注册进 capreg.Registry（归一）。
// 拆出 wireup.go 保持 ≤350 行。

package main

import (
	"context"
	"os"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// registerDiscoveredPlugins —— 注册所有 MCP-app 能力进同一个 capreg.Registry，归一：
//   - 内建：代码在独立 module（mcp-servers/*），编成静态二进制随产品发，运行时跟第三方
//     **完全同一条** sandbox_stdio 路径（bwrap）加载，origin=builtin。host 不 import 它们
//     ——契约只有下面的 manifest（id/version/transport 是数据）+ 运行时 MCP 协议。
//   - 第三方：STANDMEET_PLUGINS 声明的 stdio/http 插件，origin=managed。env 未设 →
//     无（prod 默认无第三方）。
//
// 三类走同一条 RegisterDiscoveredPlugins，只是 manifest 来源 / transport 不同。
// depReg 由 registerAgentSkills 一处建好并 SetDepRegistry（ext-mcp dep 闸与这里的
// Requires 校验共用同一份）：(a) 装配期 enabledCaps 据它把 Requires 未连的 cap 经 global
// 单点闸隐藏（D-2）；(b) 注册 config 插件时校验其 Requires —— 声明了 core 给不了的依赖名
// → 拒（fail-fast，requires-boot-reject）。
func registerDiscoveredPlugins(
	d *runtimeDeps, depReg *capreg.DepRegistry, hooks map[string]usecases.CapHooks,
) {
	registerBuiltins(d, hooks) // 内建依赖名由构造保证已知，不必再校验
	registerPluginSource(d, os.Getenv("STANDMEET_PLUGINS"), capreg.OriginManaged, depReg)
}

// connectorDepRegistry —— 命名 connector 依赖 provider 注册表。#155：拉起时 discovery 把内置
// 连接器装配进 Hub，品类 dep 由 slot 分派器背书（active 连接器 connected 才放行）。provider
// 只暴露「这个 owner 连没连」，凭据全程留在 connector 层内（句柄非凭据）。
func connectorDepRegistry(ctx context.Context, d *runtimeDeps) *capreg.DepRegistry {
	depReg := capreg.NewDepRegistry()
	if err := registerDiscoveredConnectors(ctx, d, depReg); err != nil {
		d.log.Error("register discovered connectors", "err", err)
	}
	return depReg
}

// registerBuiltins —— 随产品发的内建能力。代码在独立 module、**编译成静态二进制随镜像
// 装进插件目录**，运行时跟第三方插件**完全同一条** sandbox_stdio 路径（bwrap 隔离）。
// 归一到底：builtin 只剩 origin=builtin 这个标签，加载机制没有任何特殊路。hooks 给需要
// 运行时钩子的内建挂 per-session CapHooks（booker: connector+quota tool 闸；retrieval:
// corpus-scope fragment/enabled 闸）。
func registerBuiltins(d *runtimeDeps, hooks map[string]usecases.CapHooks) {
	manifests := []mcpplugin.Manifest{
		askVisitorManifest(), summarizeManifest(), bookerManifest(), retrievalManifest(),
		mailSenderManifest(),
	}
	dupes := usecases.RegisterDiscoveredPluginsHooked(
		d.agentSkills, manifests, capreg.OriginBuiltin, hooks, d.capDialErrLog(),
	)
	for _, id := range dupes {
		d.log.Warn("builtin register skipped (duplicate id)", "id", id)
	}
}

// capDialErrLog —— dial/list 失败(如 sandbox 起不来)在折成 ErrHidden 前把真因响出来。
// builtin(retrieval 等)与第三方插件共用。F-A-1:prod bwrap 起不来曾静默 0 工具。
func (d *runtimeDeps) capDialErrLog() func(id string, err error) {
	return func(id string, err error) {
		d.log.Warn("visitor capability failed to bind — hidden from this session",
			"cap", id, "err", err)
	}
}

// retrievalManifest —— corpus.retrieval 内建：静态二进制在 /srv/plugins/retrieval，经
// sandbox_stdio 在 bwrap 里跑。它要后端 corpus 数据（wiki/output/writing listers）→
// HostSockets 绑窄 unix socket（host 跑 search/read/list pipeline），插件断网经 socket
// 够到。per-session corpus-ACL scope（role snapshot 的 URI glob 白名单）经 tool-call
// `_meta` 携给插件、插件转进 socket 请求，host op 重建 AllowsCorpus。ACL=always（tool
// 恒暴露，scope 空则结果空，跟旧 in-process 行为一致）；tool 保 canonical 名
// corpus_search / corpus_read / corpus_list。
func retrievalManifest() mcpplugin.Manifest {
	const sock = "/run/standmeet/retrieval.sock"
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
			Env:     map[string]string{"RETRIEVAL_SOCKET": sock},
			Sandbox: &mcpplugin.Sandbox{
				PluginDir:   "/srv/plugins/retrieval",
				HostSockets: []string{sock},
			},
		},
	}
}

// mailSenderManifest —— mail.send 内建：访客向 owner 配的 mail 连接器发信。硬依赖 mail 品类槽
// （dep provider 名 "smtp"）connected → 未连经 global 单点闸隐藏。沙箱插件经 host socket 调
// MailContract.Send，落到 active mail 连接器（openapi SaaS / SMTP，插件不知 kind）。
func mailSenderManifest() mcpplugin.Manifest {
	const sock = "/run/standmeet/mail-sender.sock"
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
			Env:     map[string]string{"MAIL_SENDER_SOCKET": sock},
			Sandbox: &mcpplugin.Sandbox{
				PluginDir:   "/srv/plugins/mail-sender",
				HostSockets: []string{sock},
			},
		},
	}
}

// bookerManifest —— calendar.book 内建：静态二进制在 /srv/plugins/booker，经
// sandbox_stdio 在 bwrap 里跑。它要后端数据（日历 connector / booking store / owner /
// 约成通知）→ HostSockets 绑窄 unix socket（host 跑 book/list_slots pipeline），插件
// 断网经 socket 够到。ACL=role-granted（role 的 AllowedTools 含 calendar.book 才暴露）；
// 再叠一个 SessionGate（connector-connected + quota，composition root 经 NewBookerGate
// 注入）。tool 保 canonical 名 calendar_book / calendar_list_slots。卡片暂仍由前端
// 旧渲染器按 result wire 画（ui:// 迁移是 #134），故这里不声明 UI。
func bookerManifest() mcpplugin.Manifest {
	const sock = "/run/standmeet/booker.sock"
	return mcpplugin.Manifest{
		ID:           "calendar.book",
		Title:        "Book a meeting",
		Version:      "1",
		Shape:        mcpplugin.ShapeVisitorOnly,
		ACL:          mcpplugin.ACLRoleGranted,
		RawToolNames: true,
		// 硬依赖 calendar connector：未连 → 经 global 单点闸隐藏（D-2，取代 booker
		// SessionGate 里的 Connected() 自查）。smtp 不在此 —— 确认信是软依赖，没连也能
		// book，只是 send_confirmation 那截不可用（per-tool，不 gate 整 cap）。
		Requires: []string{"calendar"},
		Transport: mcpplugin.Transport{
			Kind:    mcpplugin.TransportSandboxStdio,
			Command: "/plugin/booker",
			Env:     map[string]string{"BOOKER_SOCKET": sock},
			Sandbox: &mcpplugin.Sandbox{
				PluginDir:   "/srv/plugins/booker",
				HostSockets: []string{sock},
			},
		},
	}
}

// summarizeManifest —— summarize 内建：静态二进制在 /srv/plugins/summarize，经
// sandbox_stdio 在 bwrap 里跑。它要后端数据（transcript/LLM/落库）→ HostSockets 绑一个
// 窄 unix socket（host 跑 report pipeline），插件断网经 socket 够到。tool 保 canonical
// 名 summarize_conversation；ACL=always（summarize 原对所有 mode 暴露）。
func summarizeManifest() mcpplugin.Manifest {
	const sock = "/run/standmeet/summarize.sock"
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
				PluginDir:   "/srv/plugins/summarize",
				HostSockets: []string{sock},
			},
		},
	}
}

// askVisitorManifest —— ask_visitor 内建：静态二进制在 /srv/plugins/ask-visitor，经
// sandbox_stdio 在 bwrap 里跑（无后端数据依赖 → 无 HostSockets、完全断网）。ui:// 卡
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

// registerPluginSource —— 加载一条发现源配置并以指定 origin 注册。声明了 core 给不了的
// 命名依赖（Requires 里有未注册的 connector 名）的插件 → 拒 + log，不让它带着满足不了的
// 依赖上（fail-fast，跟 version 闸同性质）。
func registerPluginSource(
	d *runtimeDeps, path string, origin capreg.Origin, depReg *capreg.DepRegistry,
) {
	res, err := mcpplugin.Load(path)
	if err != nil {
		d.log.Error("plugin config load", "origin", string(origin), "err", err)
		return
	}
	for i := range res.Skipped {
		d.log.Warn("plugin manifest skipped",
			"id", res.Skipped[i].ID, "reason", res.Skipped[i].Reason)
	}
	kept := keepResolvableDeps(d, res.Manifests, depReg)
	dupes := usecases.RegisterDiscoveredPlugins(d.agentSkills, kept, origin, d.capDialErrLog())
	for _, id := range dupes {
		d.log.Warn("plugin register skipped (duplicate id)", "id", id)
	}
}

// keepResolvableDeps —— 丢掉声明了 core 给不了的命名依赖（Requires 里有未注册 connector
// 名）的 manifest + log；其余原样保留（requires-boot-reject，fail-fast）。
func keepResolvableDeps(
	d *runtimeDeps, manifests []mcpplugin.Manifest, depReg *capreg.DepRegistry,
) []mcpplugin.Manifest {
	kept := make([]mcpplugin.Manifest, 0, len(manifests))
	for i := range manifests {
		if unknown := depReg.Unknown(manifests[i].Requires); len(unknown) > 0 {
			d.log.Warn("plugin register rejected (unknown required dependency)",
				"id", manifests[i].ID, "unknown_requires", unknown)
			continue
		}
		kept = append(kept, manifests[i])
	}
	return kept
}
