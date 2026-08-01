// collect.go —— 收口做的全部事情:import 各域的 facade,把它们声明的操作汇成资源。
//
// 这个文件是"这台实例对外能做的每一件事"的目录页 —— 一个域一行。它不认识任何域的
// 内部结构,只认识各域的正门;操作长什么样、怎么做,是域自己说的。
//
// Deps 由组装根填(它知道哪些 repo 在跑)。收口不构造任何东西。

package dispatcher

import (
	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// Deps —— 各域对外声明操作时需要的依赖包,由组装根填。
type Deps struct {
	AccessRequests owner.OpsAccessRequests
	Codes          access.OpsCodes
	Corpus         corpus.Deps
	Writings       corpus.OpsWritingsDeps
	Instance       stats.InstanceDeps
	Page           owner.OpsPage
	Account        owner.OpsAccountDeps
	Roles          access.OpsRoles
	SEO            owner.OpsSEO
	Marketplace    marketplace.InstallSkillDeps
	CustomPages    owner.CustomPageDeps
	Skills         marketplace.SkillsDeps
	MCPServers     marketplace.MCPServersDeps
	OwnerCSS       owner.CSSStore
	BannedIPs      *security.BannedIPRepo
	AllowedDomains owner.AllowedDomainsDeps
	APIKeys        access.OpsAPIKeys
	Conversations  conversation.OpsConversations
	Prompts        owner.PromptsDeps
	Settings       owner.SettingsDeps
}

// Collect —— 把各域声明的操作汇成资源清单。一个资源一行。
func Collect(d *Deps) []Resource {
	return []Resource{
		{Name: "subjectivity", Ops: corpus.SubjectivityOps(d.Corpus)},
		{Name: "ip_bans", Ops: security.IPBanOps(d.BannedIPs)},
		{Name: "domains", Ops: owner.DomainOps(d.AllowedDomains)},
		{Name: "appearance", Ops: owner.AppearanceOps(d.OwnerCSS)},
		{Name: "prompts", Ops: owner.PromptOps(d.Prompts)},
		{Name: "settings", Ops: owner.SettingsOps(d.Settings)},
		{Name: "account", Ops: owner.AccountOps(d.Account)},
		{Name: "custom_pages", Ops: owner.CustomPageOps(d.CustomPages)},
		{Name: "writings", Ops: corpus.WritingOps(d.Writings)},
		{Name: "instance", Ops: stats.InstanceOps(d.Instance)},
		{Name: "mcp_servers", Ops: marketplace.MCPServerOps(d.MCPServers)},
		{Name: "skills", Ops: marketplace.SkillOps(d.Skills)},
		{Name: "marketplace", Ops: marketplace.MarketplaceOps(d.Marketplace)},
		{Name: "codes", Ops: access.CodeOps(d.Codes)},
		{Name: "access_requests", Ops: owner.AccessRequestOps(d.AccessRequests)},
		{Name: "seo", Ops: owner.SEOOps(d.SEO)},
		{Name: "page", Ops: owner.PageOps(d.Page)},
		{Name: "roles", Ops: access.RoleOps(d.Roles)},
		{Name: "conversations", Ops: conversation.ConversationOps(&d.Conversations)},
		{Name: "api_keys", Ops: access.APIKeyOps(d.APIKeys)},
	}
}
