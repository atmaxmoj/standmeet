// plugins.go —— composition root: 把所有 MCP-app 能力注册进 capreg.Registry（归一）。
// 拆出 wireup.go 保持 ≤350 行。

package main

import (
	"os"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/usecases"
	askvisitor "github.com/atmaxmoj/standmeet/mcp-servers/ask-visitor"
)

// registerDiscoveredPlugins —— 注册所有 MCP-app 能力进同一个 capreg.Registry，归一：
//   - 内建：代码解耦在独立 module（mcp-servers/ask-visitor 等），运行时 in-process
//     加载（server 对象 + 元数据），origin=builtin。prod 也在。
//   - 第三方：STANDMEET_PLUGINS 声明的 stdio/http 插件，origin=managed。env 未设 →
//     无（prod 默认无第三方）。
//
// 三类走同一条 RegisterDiscoveredPlugins，只是 manifest 来源 / transport 不同。
func registerDiscoveredPlugins(d *runtimeDeps, hooks map[string]usecases.CapHooks) {
	// connector 命名依赖注册表先建好：(a) 装配期 enabledCaps 据它把 Requires 未连的 cap
	// 经 global 单点闸隐藏（D-2）；(b) 注册 config 插件时校验其 Requires —— 声明了 core
	// 给不了的依赖名 → 拒（fail-fast，requires-boot-reject）。
	depReg := connectorDepRegistry(d)
	d.agentSkills.SetDepRegistry(depReg)
	registerBuiltins(d, hooks) // 内建依赖名由构造保证已知，不必再校验
	registerPluginSource(d, os.Getenv("STANDMEET_PLUGINS"), capreg.OriginManaged, depReg)
}

// connectorDepRegistry —— 命名 connector 依赖 provider 注册表。provider 只暴露「这个
// owner 连没连」，凭据全程留在 connector proxy 内（句柄非凭据）。
func connectorDepRegistry(d *runtimeDeps) *capreg.DepRegistry {
	depReg := capreg.NewDepRegistry()
	depReg.Register(capreg.NamedProvider("calendar", calendarProxy(d).Connected))
	depReg.Register(capreg.NamedProvider("smtp", mailProxy(d).Connected))
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
	}
	dupes := usecases.RegisterDiscoveredPluginsHooked(
		d.agentSkills, manifests, capreg.OriginBuiltin, hooks)
	for _, id := range dupes {
		d.log.Warn("builtin register skipped (duplicate id)", "id", id)
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
		ID:           askvisitor.ID,
		Version:      askvisitor.Version,
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
	kept := make([]mcpplugin.Manifest, 0, len(res.Manifests))
	for i := range res.Manifests {
		if unknown := depReg.Unknown(res.Manifests[i].Requires); len(unknown) > 0 {
			d.log.Warn("plugin register rejected (unknown required dependency)",
				"id", res.Manifests[i].ID, "unknown_requires", unknown)
			continue
		}
		kept = append(kept, res.Manifests[i])
	}
	dupes := usecases.RegisterDiscoveredPlugins(d.agentSkills, kept, origin)
	for _, id := range dupes {
		d.log.Warn("plugin register skipped (duplicate id)", "id", id)
	}
}
