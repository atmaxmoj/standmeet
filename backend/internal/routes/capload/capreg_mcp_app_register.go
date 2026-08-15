// capreg_mcp_app_register.go —— 把发现来源的 manifest 变成注册好的能力（从
// capreg_mcp_app.go 拆出来守 check-max-lines）。
//
// 这一段是**装配**：谁进注册表、带什么 origin、撞 ID 怎么办、哪些能力是「无条件暴露」的。
// 隔壁那个文件是**能力自己的行为**（拨号、暴露门、state/prompt 贡献）。

package capload

import (
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// RegisterDiscoveredPlugins —— 把发现来源的 manifest 逐个注册成 mcpAppCapability
// 进同一个 Registry，带指定 origin：
//   - OriginBuiltin：随产品镜像发的 bundled 内建（外置后的 ask_visitor 等）。这条源
//     prod 也在；管理面不可删（删 = 改镜像）。
//   - OriginManaged：部署期经 STANDMEET_PLUGINS 声明装上的第三方/集成插件。
//
// 撞 ID(跟别的内建或彼此) → 跳过该条、收进返回的 skipped(caller log),不让一个坏
// 插件 panic 整个 boot。
func RegisterDiscoveredPlugins(
	reg *capreg.Registry, manifests []mcpplugin.Manifest, origin capreg.Origin,
	dialErrLog func(id string, err error),
) []string {
	return RegisterDiscoveredPluginsHooked(reg, manifests, origin, nil, dialErrLog)
}

// RegisterDiscoveredPluginsHooked —— RegisterDiscoveredPlugins + 给特定 ID 的插件挂
// per-session 钩子（CapHooks）。由 composition root 注入（连接器 proxy / store / corpus
// scope 都在那）：booker 用 Gate 做 connector+quota 的 tool 隐藏；retrieval 用 Fragment
// 做 corpus-scope 的 prompt/enabled 闸。hooks 为 nil / 无此 ID → 无额外钩子（默认）。
func RegisterDiscoveredPluginsHooked(
	reg *capreg.Registry, manifests []mcpplugin.Manifest, origin capreg.Origin,
	hooks map[string]CapHooks, dialErrLog func(id string, err error),
) []string {
	skipped := []string{}
	always := []string{}
	for i := range manifests {
		c := hookedCap(&manifests[i], hooks, dialErrLog)
		if err := reg.RegisterOrigin(c, origin); err != nil {
			skipped = append(skipped, manifests[i].ID)
			continue
		}
		if manifests[i].ACL == mcpplugin.ACLAlways {
			always = append(always, manifests[i].ID)
		}
	}
	// 把「无条件暴露」的那几个 id 告诉注册表：暴露门读的是 manifest 的 ACL（`mcpAppGranted`），
	// 而**能不能挂到某个 role 的 dock 上**问的是同一件事。不交上去，注册表只能拿「注册了哪些」
	// 当合法名单，于是 role 收得下一颗它永远给不出的按钮（F-D-13）。
	reg.SetAlwaysGranted(append(reg.AlwaysGranted(), always...))
	return skipped
}

// hookedCap —— 一个 manifest 对应的能力，挂上 composition root 给它的那几个钩子。
func hookedCap(
	m *mcpplugin.Manifest, hooks map[string]CapHooks, dialErrLog func(id string, err error),
) *mcpAppCapability {
	appCap := newMCPAppCapability(m)
	appCap.dialErrLog = dialErrLog
	if h, ok := hooks[m.ID]; ok {
		appCap.gate = h.Gate
		appCap.fragmentGate = h.Fragment
		appCap.stateHook = h.State
	}
	return appCap
}
