// capreg_register.go —— Phase B: capreg.Registry 的 builtin 注册口。
// composition root (cmd/server/wireup.go) 在 buildPublicDeps 之后调
// RegisterAgentSkills(reg, &visitor) 一次，把 visitor-side 内建 capability
// 全部 register 进去。
//
// 各 B-N 在这里 append 一行：
//   B-2: corpus.retrieval (✓)
//   B-3: calendar.book / ext.<server> / skill.<name>
//   B-5: job-loop owner-only
//   B-6: MCP parity

package usecases

import "github.com/atmaxmoj/standmeet/internal/capreg"

// RegisterVisitorSkills —— 注册口。跟 prod 同一组 capability 构造
// (newRetrievalCapability / booker / skill-runner / ext-mcp)，按各 capability 的
// 窄 deps 从 VisitorSkillsDeps 取料。booker 的 Calendar 在 eval 留 nil →
// VisitorBinding ErrHidden 自动隐藏。
//
// ask_visitor + summarize 已外置成沙箱插件（mcp-servers/*），由 composition root
// 走统一 sandbox_stdio 路径以 origin=builtin 加载，主 app 内不再有它们的 capability
// 代码。summarize 的 report pipeline 留作 host socket op（capreg_summarize_socket.go），
// 不在这里注册成 capability。sumChats 仍透传供 composition root 起 summarize socket
// server 用（这里不再消费它）。
func RegisterVisitorSkills(
	reg *capreg.Registry, deps *VisitorSkillsDeps, _ ConversationGetter,
) {
	reg.MustRegister(newRetrievalCapability(retrievalDeps{
		Wiki: deps.Wiki, Output: deps.Output, Writings: deps.Writings,
	}))
	reg.MustRegister(newCalendarBookCapability(&bookerDeps{
		Proxy: deps.Proxy, Store: deps.Calendar, Owners: deps.Owners, Notify: deps.Notify,
	}))
	reg.MustRegister(newSkillRunnerCapability(skillRunnerDeps{
		Skills: deps.Skills, Sandbox: deps.Sandbox,
	}))
	reg.MustRegister(newExtMCPCapability(deps.MCPServers))
}
