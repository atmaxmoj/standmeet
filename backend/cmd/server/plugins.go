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
func registerDiscoveredPlugins(d *runtimeDeps) {
	registerBuiltins(d)
	registerPluginSource(d, os.Getenv("STANDMEET_PLUGINS"), capreg.OriginManaged)
}

// registerBuiltins —— 随产品发的内建能力。代码在独立 module、**编译成静态二进制随镜像
// 装进插件目录**，运行时跟第三方插件**完全同一条** sandbox_stdio 路径（bwrap 隔离）。
// 归一到底：builtin 只剩 origin=builtin 这个标签，加载机制没有任何特殊路。
func registerBuiltins(d *runtimeDeps) {
	manifests := []mcpplugin.Manifest{askVisitorManifest()}
	dupes := usecases.RegisterDiscoveredPlugins(d.agentSkills, manifests, capreg.OriginBuiltin)
	for _, id := range dupes {
		d.log.Warn("builtin register skipped (duplicate id)", "id", id)
	}
}

// askVisitorManifest —— ask_visitor 内建：静态二进制在 /srv/plugins/ask-visitor，经
// sandbox_stdio 在 bwrap 里跑（无后端数据依赖 → 无 HostSockets、完全断网）。元数据
// （acl=always / raw 名 / ui:// 卡）跟以前一致，只是加载从 in-process 换成沙箱二进制。
func askVisitorManifest() mcpplugin.Manifest {
	return mcpplugin.Manifest{
		ID:           askvisitor.ID,
		Version:      askvisitor.Version,
		Shape:        mcpplugin.ShapeVisitorOnly,
		ACL:          mcpplugin.ACLAlways,
		RawToolNames: true,
		UI: &mcpplugin.UI{
			ResourceURI: askvisitor.UICardURI, MimeType: askvisitor.UICardMIME,
		},
		Transport: mcpplugin.Transport{
			Kind:    mcpplugin.TransportSandboxStdio,
			Command: "/plugin/ask-visitor",
			Sandbox: &mcpplugin.Sandbox{PluginDir: "/srv/plugins/ask-visitor"},
		},
	}
}

// registerPluginSource —— 加载一条发现源配置并以指定 origin 注册。
func registerPluginSource(d *runtimeDeps, path string, origin capreg.Origin) {
	res, err := mcpplugin.Load(path)
	if err != nil {
		d.log.Error("plugin config load", "origin", string(origin), "err", err)
		return
	}
	for i := range res.Skipped {
		d.log.Warn("plugin manifest skipped",
			"id", res.Skipped[i].ID, "reason", res.Skipped[i].Reason)
	}
	dupes := usecases.RegisterDiscoveredPlugins(d.agentSkills, res.Manifests, origin)
	for _, id := range dupes {
		d.log.Warn("plugin register skipped (duplicate id)", "id", id)
	}
}
