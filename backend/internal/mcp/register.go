// register.go —— Phase B-4: owner-side Capability 注册口。composition
// root (cmd/server/wireup.go) 调一次，把所有 owner-MCP-only capability
// register 进 agentskills.Registry。
//
// visitor-side capability 由 usecases.RegisterAgentSkills 注册；owner-side
// 由本函数注册。两者共用同一 *Registry，互不重 ID。

package mcp

import (
	"log/slog"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// RegisterDeps —— RegisterAgentSkills 需要的窄接口集；不让 register 调用
// 顺势依赖整 mcp.Deps (mcp.Deps 自带 AgentSkills 字段，传整个会绕回)。
type RegisterDeps struct {
	Owners OwnerLookup
	SEO    SEOWriter
	Codes  CodesRevoker
	Corpus *usecases.CorpusDeps
	Log    *slog.Logger
}

// RegisterAgentSkills —— 注册所有 owner-side capability。重 ID panic
// (boot 期失败比运行时漏注册好)。后续 commit 把 jobs / resume /
// applications / custom_page 等 file 也搬进来。
func RegisterAgentSkills(reg *agentskills.Registry, deps RegisterDeps) {
	reg.MustRegister(newMeCapability(deps.Owners, deps.Log))
	reg.MustRegister(newSEOCapability(deps.SEO, deps.Log))
	reg.MustRegister(newCodesCapability(deps.Codes, deps.Log))
	reg.MustRegister(newCorpusRawCapability(deps.Corpus, deps.SEO, deps.Log))
}
