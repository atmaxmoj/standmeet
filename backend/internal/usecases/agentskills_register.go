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
//
// prod 路径：summarize 的 transcript 源就是 deps.Chats（活的 chat repo）。
// 委托给 RegisterVisitorSkills，把这个源显式传成 ConversationGetter，让
// 非 prod driver（F.2 eval facade，backend/agentcore）能换成 fixture transcript
// —— 跑的是同一套真 capability 构造，只换数据源。
func RegisterAgentSkills(reg *agentskills.Registry, deps *VisitorDeps) {
	RegisterVisitorSkills(reg, deps, deps.Chats)
}

// RegisterVisitorSkills —— 实际注册口。跟 prod 同一组 capability 构造
// (newRetrievalCapability / booker / skill-runner / ext-mcp / ask_visitor /
// summarize)，但 summarize 的对话源由 sumChats 显式注入：prod 传 deps.Chats，
// eval facade 传返回 fixture 对话的 ConversationGetter。其余 capability 的数据源
// 仍走 deps（corpus 走 deps.Wiki/Output/Writings 的注入实现；booker 走
// deps.Calendar，eval 留 nil → VisitorBinding ErrHidden 自动隐藏）。
func RegisterVisitorSkills(
	reg *agentskills.Registry, deps *VisitorDeps, sumChats ConversationGetter,
) {
	reg.MustRegister(newRetrievalCapability(deps))
	reg.MustRegister(newCalendarBookCapability(deps))
	reg.MustRegister(newSkillRunnerCapability(deps))
	reg.MustRegister(newExtMCPCapability(deps))
	// I.1: ask_visitor 是 deps-less echo tool；所有 mode 都暴露，AI 自决
	// 何时调，调完 eino ADK ReturnDirectly 直接结束 agent loop。
	reg.MustRegister(newAskVisitorCapability())
	// I.3: summarize_conversation 调一次 inference.Generate 出 HTML 报告
	// 落 chat_reports。所有 mode 都暴露 (visitor 自己拿 session 调，
	// public visitor 一次额外 LLM call 也 OK)。
	reg.MustRegister(NewSummarizeCapability(&SummarizeDeps{
		Chats: sumChats, Reports: deps.Reports, Resolver: deps.Resolver,
	}))
}
