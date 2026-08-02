// capreg_register.go —— Phase B: capreg.Registry 的 builtin 注册口。
// composition root (cmd/server/boot_wireup.go) 在 buildPublicDeps 之后调
// RegisterAgentSkills(reg, &visitor) 一次，把 visitor-side 内建 capability
// 全部 register 进去。
//
// 各 B-N 在这里 append 一行：
//   B-2: corpus.retrieval (✓)
//   B-3: calendar.book / ext.<server> / skill.<name>
//   B-5: job-loop owner-only
//   B-6: MCP parity

package capload

import (
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
)

// RegisterVisitorSkills —— 注册口。跟 prod 同一组 capability 构造
// (newRetrievalCapability / booker / skill-runner / ext-mcp)，按各 capability 的
// 窄 deps 从 conversation.VisitorSkillsDeps 取料。
//
// 四个 leaf 能力（ask_visitor / summarize / calendar.book / corpus.retrieval）已**全部**
// 外置成沙箱插件（mcp-servers/*），由 composition root 走统一 sandbox_stdio 路径以
// origin=builtin 加载，主 app 内不再有任何 specific MCP 能力代码。要后端数据的
// （summarize / booker / retrieval）留 host socket op（capreg_*_socket.go），不在这里
// 注册成 capability。booker 的 per-session 暴露闸（connector+quota）以 capreg.SessionGate
// 由 composition root 注入（NewBookerGate）。
//
// 这里只剩 skill.runner + ext.mcp —— 它们是 loader/机制（装载第三方 skill / MCP server），
// 不是 leaf 能力，故不外置。sumChats 第三参已不消费（透传保签名）。
func RegisterVisitorSkills(
	reg *capreg.Registry, deps *conversation.VisitorSkillsDeps, _ conversation.Getter,
) {
	reg.MustRegister(newSkillRunnerCapability(skillRunnerDeps{
		Skills: deps.Skills, Sandbox: deps.Sandbox,
	}))
	reg.MustRegister(newExtMCPCapability(deps.MCPServers, deps.DepConnected))
	if deps.AgentConnectors != nil {
		reg.MustRegister(newOpenapiAgentToolsCapability(deps.AgentConnectors))
	}
}
