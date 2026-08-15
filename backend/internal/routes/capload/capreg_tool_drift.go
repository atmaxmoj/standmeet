// capreg_tool_drift.go —— manifest 里那份 `visitor_tools` 声明，跟沙箱真答的那份对账。
//
// 为什么会有两份：访客工具名的真相在沙箱那边（拨号时 tools/list 回什么就是什么），而有人
// 要在**拨号之前**就问「哪个工具是哪个能力的」—— 市场卡上那句 "needs X connector" 就是
// （F-F-4）。于是能力在 manifest 里声明一份，首拨时对一次账。
//
// 不对账的副本会漂，而漂了没人会发现：装配照常成功，只是产品对那个问题开始答错。
//
// **绑定用的仍是真的那份**：声明可以过期，不许让它改变访客拿到什么。
// 判定在 mcpplugin（声明住的地方），这里只把结论记出来。

package capload

import (
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// VisitorToolNames —— manifest 里声明的访客工具名（capreg.ProvidesVisitorTools）。
// 空 = 这个能力没声明，于是「这个工具是谁的」在拨号之前查不到它 —— 那是未知，不是没有。
func (c *mcpAppCapability) VisitorToolNames() []string { return c.m.VisitorTools }

// reportToolDrift —— 首拨是**真答案第一次到手**的那一刻，拿它对一遍声明。
func reportToolDrift(m *mcpplugin.Manifest, dialed []mcpclient.Tool) {
	drift := mcpplugin.VisitorToolDrift(m, toolNames(dialed))
	if drift.Drifted {
		slog.Default().Error(
			"capability visitor_tools declaration is stale — the sandbox offers a different set",
			"cap", m.ID,
			"declared_but_absent", drift.DeclaredButAbsent,
			"offered_but_undeclared", drift.OfferedButUndeclared)
	}
}

func toolNames(dialed []mcpclient.Tool) []string {
	out := make([]string, 0, len(dialed))
	for i := range dialed {
		out = append(out, dialed[i].Name)
	}
	return out
}
