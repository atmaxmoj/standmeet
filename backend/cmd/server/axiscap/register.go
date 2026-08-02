// register.go —— composition root: 把所有 MCP-app 能力注册进 capreg.Registry（归一）。
// 从 boot_wireup.go 拆出来保持 ≤350 行。

package axiscap

import (
	"os"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"
)

// RegisterDiscoveredPlugins —— 注册所有 MCP-app 能力进同一个 capreg.Registry，归一：
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
func RegisterDiscoveredPlugins(
	d *deps.Runtime, depReg *capreg.DepRegistry, hooks map[string]capload.CapHooks,
) {
	registerBuiltins(d, hooks) // 内建依赖名由构造保证已知，不必再校验
	registerPluginSource(d, os.Getenv("STANDMEET_PLUGINS"), capreg.OriginManaged, depReg)
}

// registerBuiltins —— 随产品发的内建能力。代码在独立 module、**编译成静态二进制随镜像
// 装进插件目录**，运行时跟第三方插件**完全同一条** sandbox_stdio 路径（bwrap 隔离）。
// 归一到底：builtin 只剩 origin=builtin 这个标签，加载机制没有任何特殊路。hooks 给需要
// 运行时钩子的内建挂 per-session CapHooks（booker: connector+quota tool 闸；retrieval:
// corpus-scope fragment/enabled 闸）。
func registerBuiltins(d *deps.Runtime, hooks map[string]capload.CapHooks) {
	dupes := capload.RegisterDiscoveredPluginsHooked(
		d.AgentSkills, BuiltinManifests(), capreg.OriginBuiltin, hooks, capDialErrLog(d),
	)
	for _, id := range dupes {
		d.Log.Warn("builtin register skipped (duplicate id)", "id", id)
	}
}

// capDialErrLog —— dial/list 失败(如 sandbox 起不来)在折成 ErrHidden 前把真因响出来。
// builtin(retrieval 等)与第三方插件共用。F-A-1:prod bwrap 起不来曾静默 0 工具。
func capDialErrLog(d *deps.Runtime) func(id string, err error) {
	return func(id string, err error) {
		d.Log.Warn("visitor capability failed to bind — hidden from this session",
			"cap", id, "err", err)
	}
}

// registerPluginSource —— 加载一条发现源配置并以指定 origin 注册。声明了 core 给不了的
// 命名依赖（Requires 里有未注册的 connector 名）的插件 → 拒 + log，不让它带着满足不了的
// 依赖上（fail-fast，跟 version 闸同性质）。
func registerPluginSource(
	d *deps.Runtime, path string, origin capreg.Origin, depReg *capreg.DepRegistry,
) {
	res, err := mcpplugin.Load(path)
	if err != nil {
		d.Log.Error("plugin config load", "origin", string(origin), "err", err)
		return
	}
	for i := range res.Skipped {
		d.Log.Warn("plugin manifest skipped",
			"id", res.Skipped[i].ID, "reason", res.Skipped[i].Reason)
	}
	kept := keepResolvableDeps(d, res.Manifests, depReg)
	dupes := capload.RegisterDiscoveredPlugins(d.AgentSkills, kept, origin, capDialErrLog(d))
	for _, id := range dupes {
		d.Log.Warn("plugin register skipped (duplicate id)", "id", id)
	}
}

// keepResolvableDeps —— 丢掉声明了 core 给不了的命名依赖（Requires 里有未注册 connector
// 名）的 manifest + log；其余原样保留（requires-boot-reject，fail-fast）。
func keepResolvableDeps(
	d *deps.Runtime, manifests []mcpplugin.Manifest, depReg *capreg.DepRegistry,
) []mcpplugin.Manifest {
	kept := make([]mcpplugin.Manifest, 0, len(manifests))
	for i := range manifests {
		if unknown := depReg.Unknown(manifests[i].Requires); len(unknown) > 0 {
			d.Log.Warn("plugin register rejected (unknown required dependency)",
				"id", manifests[i].ID, "unknown_requires", unknown)
			continue
		}
		kept = append(kept, manifests[i])
	}
	return kept
}
