// agentskills_register.go —— Phase B: agentskills.Registry 的 builtin 注册口。
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

import "github.com/atmaxmoj/standmeet/internal/agentskills"

// RegisterAgentSkills —— 把所有 builtin visitor-side capability 注册进
// registry。owner MCP server / job-loop owner-only 等 capability 后续
// commit 加入。重复 ID 会 panic，proper for boot 期。
func RegisterAgentSkills(reg *agentskills.Registry, deps *VisitorDeps) {
	reg.MustRegister(newRetrievalCapability(deps))
	reg.MustRegister(newCalendarBookCapability(deps))
	reg.MustRegister(newSkillRunnerCapability(deps))
	reg.MustRegister(newExtMCPCapability(deps))
	// I.1: ask_visitor 是 deps-less echo tool；所有 mode 都暴露，AI 自决
	// 何时调，调完 eino ADK ReturnDirectly 直接结束 agent loop。
	reg.MustRegister(newAskVisitorCapability())
}
