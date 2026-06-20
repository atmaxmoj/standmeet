// visitor_deps.go —— #131: visitor 有界上下文的两个 deps 聚合（会话生命周期 +
// capability 接线原料）。从 visitor.go 拆出守 max-lines；类型定义无逻辑。

package usecases

import (
	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/sandbox"
	"github.com/atmaxmoj/standmeet/internal/session"
)

// VisitorSessionDeps —— #131: visitor **会话生命周期**那一有界上下文所需(发码会话 /
// 公开会话 / 续会 / 历史恢复 / 配额派生 / code intro)。不含任何 tool/capability 依赖
// (那些走各 capability 的窄 deps + VisitorSkillsDeps)。god-struct 拆出来的一半。
type VisitorSessionDeps struct {
	Codes    *postgres.CodeRepo
	Chats    *postgres.ChatRepo
	Owners   OwnerGetter
	Skills   SkillGetter // role snapshot freeze 读 ListSkillsForRole
	Roles    *postgres.RoleRepo
	Prompts  *postgres.PromptRepo
	Sessions *session.VisitorSessionStore
	Wiki     WikiLister // 历史恢复 hydrate conversation view
	Output   OutputLister
	// AgentSkills —— session 装配时算 capability states / tool specs(retrieval /
	// booker / ext-mcp / owner-skill)。
	AgentSkills *capreg.Registry
}

// VisitorSkillsDeps —— #131: 注册 visitor capability 时所需的**原料**(capability
// 接线那一半)。RegisterVisitorSkills 据此构造各 capability 的窄 deps。prod wireup +
// eval facade 都构造它。不漏进业务逻辑,只在注册口用一次。
type VisitorSkillsDeps struct {
	Wiki     WikiLister
	Output   OutputLister
	Writings WritingLister
	// Proxy / Calendar —— 可选(admin 没装 connector → Proxy nil,booker gating
	// 自动隐藏)。Proxy = 连接器代调；Calendar = booking 行 store。
	Proxy      CalendarProxy
	Calendar   CalendarStore
	Owners     OwnerGetter
	Notify     OwnerNotifyDeps
	Skills     SkillGetter
	Sandbox    sandbox.Runner
	MCPServers MCPServerGetter
	Reports    ReportStore
	Resolver   inference.Resolver
}
