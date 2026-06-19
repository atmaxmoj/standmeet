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
// (newRetrievalCapability / booker / skill-runner / ext-mcp / ask_visitor /
// summarize)，按各 capability 的窄 deps 从 VisitorSkillsDeps 取料。summarize 的
// 对话源由 sumChats 显式注入：prod 传 chat repo，eval facade 传 fixture 对话源
// (跑同一套真 capability 构造,只换数据源)。booker 的 Calendar 在 eval 留 nil →
// VisitorBinding ErrHidden 自动隐藏。
func RegisterVisitorSkills(
	reg *capreg.Registry, deps *VisitorSkillsDeps, sumChats ConversationGetter,
) {
	reg.MustRegister(newRetrievalCapability(retrievalDeps{
		Wiki: deps.Wiki, Output: deps.Output, Writings: deps.Writings,
	}))
	reg.MustRegister(newCalendarBookCapability(bookerDeps{
		Proxy: deps.Proxy, Store: deps.Calendar, Owners: deps.Owners, Notify: deps.Notify,
	}))
	reg.MustRegister(newSkillRunnerCapability(skillRunnerDeps{
		Skills: deps.Skills, Sandbox: deps.Sandbox,
	}))
	reg.MustRegister(newExtMCPCapability(deps.MCPServers))
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
