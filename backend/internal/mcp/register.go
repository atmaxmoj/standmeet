// register.go —— Phase B-4: owner-side Capability 注册口。composition
// root (cmd/server/wireup.go) 调一次，把所有 owner-MCP-only capability
// register 进 capreg.Registry。
//
// visitor-side capability 由 usecases.RegisterAgentSkills 注册；owner-side
// 由本函数注册。两者共用同一 *Registry，互不重 ID。
//
// J.5 起 jobs / resume / applications 三套 capability 不再在这里硬编码 —
// 走 plugins/jobs/jobs.Plugin.RegisterCapabilities，由 composition root 通
// 过 pluginRegistry.RegisterAllCapabilities 一次性挂全部 plugin 的 hook。

package mcp

import (
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// RegisterDeps —— RegisterAgentSkills 需要的窄接口集；不让 register 调用
// 顺势依赖整 mcp.Deps (mcp.Deps 自带 AgentSkills 字段，传整个会绕回)。
type RegisterDeps struct {
	Owners        OwnerLookup
	SEO           SEOWriter
	Codes         CodesRevoker
	Corpus        *usecases.CorpusDeps
	Conversations *usecases.ConversationsDeps
	Prompts       *usecases.PromptsDeps
	Roles         *usecases.RolesDeps
	MCPServers    *usecases.MCPServersDeps
	Skills        *usecases.SkillsDeps
	Writings      *usecases.WritingsDeps
	WritingsTx    *usecases.WritingsTxDeps
	CustomPages   *usecases.CustomPageDeps
	Handle        *usecases.HandleDeps
	Calendar      *CalendarOwnerDeps
	Log           *slog.Logger
}

// CalendarOwnerDeps —— newCalendarCapability 入参打包。client + store
// 都从 usecases 重新声明的接口；wireup.go 时 *gcal.Client +
// *postgres.CalendarRepo 同时满足。
type CalendarOwnerDeps struct {
	Proxy usecases.CalendarProxy
	Store CalendarOwnerStore
}

// RegisterAgentSkills —— 注册所有 owner-side capability。重 ID panic
// (boot 期失败比运行时漏注册好)。jobs / resume / applications 三套已
// 拎到 plugins/jobs (J.5)，wireup 在调本函数之后再调
// pluginRegistry.RegisterAllCapabilities 补齐。
func RegisterAgentSkills(reg *capreg.Registry, deps *RegisterDeps) {
	reg.MustRegister(newMeCapability(deps.Owners, deps.Log))
	reg.MustRegister(newSEOCapability(deps.SEO, deps.Log))
	reg.MustRegister(newCodesCapability(deps.Codes, deps.Log))
	reg.MustRegister(newCorpusRawCapability(deps.Corpus, deps.SEO, deps.Log))
	reg.MustRegister(newCorpusOutputCapability(deps.Corpus, deps.SEO, deps.Log))
	reg.MustRegister(newCorpusMutationsCapability(deps.Corpus, deps.Log))
	reg.MustRegister(newChatCapability(deps.Corpus, deps.Conversations, deps.Log))
	reg.MustRegister(newPromptsCapability(deps.Prompts, deps.Log))
	reg.MustRegister(newRolesCapability(deps.Roles, deps.Log))
	reg.MustRegister(newMCPServersCapability(deps.MCPServers, deps.Log))
	reg.MustRegister(newSkillsCapability(deps.Skills, deps.Log))
	reg.MustRegister(newWritingsCapability(deps.WritingsTx, deps.Writings, deps.Log))
	reg.MustRegister(newCustomPageCapability(deps.CustomPages, deps.Log))
	reg.MustRegister(newPageCapability(deps.Handle, deps.Log))
	reg.MustRegister(newCalendarCapability(
		deps.Calendar.Proxy, deps.Calendar.Store, deps.Owners, deps.Log,
	))
}
