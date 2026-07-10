// Package ownercore —— #135 externalization. ALL owner-side MCP capabilities that used to be
// core-registered in mcphandle's RegisterAgentSkills now live here as one in-process plugin, using
// the jobs-plugin pattern (plugins.CapabilityRegistrar) — no separate process/socket, since owner
// tools are trusted (owner-authenticated MCP facade) and need no sandbox isolation like the visitor
// leaf caps. This is what makes core zero-owner-capabilities without per-cap process overhead.
package ownercore

import (
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/plugins"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// Name —— plugin registry identity.
const Name = "ownercore"

// Deps —— every owner-cap's narrow dependency (was mcphandle.RegisterDeps, moved here verbatim).
type Deps struct {
	Marketplace    usecases.InstallSkillDeps
	Appearance     usecases.OwnerCSSStore
	Codes          CodesRevoker
	SEO            SEOWriter
	SEOStats       seoStatsReader
	PageContent    pageContentStore
	CodeDenials    codeDenialsStore
	IPBans         ipBansStore
	Owners         OwnerLookup
	Skills         *usecases.SkillsDeps
	Connectors     *ConnectorsOwnerDeps
	CustomPages    *usecases.CustomPageDeps
	Handle         *usecases.HandleDeps
	Calendar       *CalendarOwnerDeps
	Writings       *usecases.WritingsDeps
	MCPServers     *usecases.MCPServersDeps
	Domains        usecases.AllowedDomainsDeps
	AccessRequests *AccessRequestsOwnerDeps
	Capabilities   *CapabilitiesOwnerDeps
	Instance       *InstanceDeps
	APIKeys        *APIKeysOwnerDeps
	WritingsTx     *usecases.WritingsTxDeps
	Roles          *usecases.RolesDeps
	Booking        *BookingOwnerDeps
	Prompts        *usecases.PromptsDeps
	Conversations  *usecases.ConversationsDeps
	PublicURL      usecases.PublicURLDeps
	Corpus         *usecases.CorpusDeps
	Account        usecases.AccountDeps
	BYOAI          usecases.BYOAIDeps
	Log            *slog.Logger
	Ghosts         *usecases.GhostDeps
	AIPresets      []AIProviderPreset
}

// Plugin —— implements plugins.Plugin + plugins.CapabilityRegistrar.
type Plugin struct {
	deps *Deps
}

var (
	_ plugins.Plugin              = (*Plugin)(nil)
	_ plugins.CapabilityRegistrar = (*Plugin)(nil)
)

// New 构造 owner-core 插件。deps 是 boot 期一次性的 fat 依赖包，用指针避免 160B 值拷贝。
func New(deps *Deps) *Plugin { return &Plugin{deps: deps} }

// Name —— plugins.Plugin.
func (*Plugin) Name() string { return Name }

// RegisterCapabilities —— plugins.CapabilityRegistrar: register every owner-MCP capability into
// core capreg (was mcphandle.RegisterAgentSkills). dup/empty ID panics via capreg.MustRegister.
func (p *Plugin) RegisterCapabilities(reg *capreg.Registry) {
	d := p.deps
	reg.MustRegister(newMeCapability(d.Owners, d.Log))
	reg.MustRegister(newCodesCapability(d.Codes, d.CodeDenials, d.Log))
	reg.MustRegister(newSEOCapability(d.SEO, d.SEOStats, d.Log))
	reg.MustRegister(newCorpusRawCapability(d.Corpus, d.SEO, d.Log))
	reg.MustRegister(newCorpusOutputCapability(d.Corpus, d.SEO, d.Log))
	reg.MustRegister(newCorpusMutationsCapability(d.Corpus, d.Log))
	reg.MustRegister(newSubjectivityCapability(d.Corpus, d.Log))
	reg.MustRegister(newAppearanceCapability(d.Appearance, d.Log))
	reg.MustRegister(newChatCapability(d.Corpus, d.Conversations, d.Ghosts, d.Log))
	reg.MustRegister(newPromptsCapability(d.Prompts, d.Log))
	reg.MustRegister(newRolesCapability(d.Roles, reg.VisitorCapabilityIDs, d.Log))
	reg.MustRegister(newMCPServersCapability(d.MCPServers, d.Log))
	reg.MustRegister(newSkillsCapability(d.Skills, d.Log))
	reg.MustRegister(newWritingsCapability(d.WritingsTx, d.Writings, d.Log))
	reg.MustRegister(newCustomPageCapability(d.CustomPages, d.Log))
	reg.MustRegister(newPageCapability(d.Handle, d.PageContent, d.PublicURL, d.Log))
	reg.MustRegister(newCalendarCapability(d.Calendar.Proxy, d.Calendar.Store, d.Owners, d.Log))
	// facade-parity fills.
	reg.MustRegister(newIPBansCapability(d.IPBans, d.Log))
	reg.MustRegister(newDomainsCapability(d.Domains, d.Log))
	reg.MustRegister(newAccessRequestsCapability(d.AccessRequests, d.Log))
	reg.MustRegister(newCapabilitiesCapability(d.Capabilities, d.Log))
	reg.MustRegister(newInstanceCapability(d.Instance, d.Log))
	reg.MustRegister(newAPIKeysCapability(d.APIKeys, d.Log))
	reg.MustRegister(newConnectorsCapability(d.Connectors, d.Log))
	reg.MustRegister(newMarketplaceCapability(d.Marketplace, d.Log))
	reg.MustRegister(newBookingCapability(d.Booking, d.Log))
	reg.MustRegister(newAccountCapability(d.Account, d.Log))
	reg.MustRegister(newBYOAICapability(d.BYOAI, d.Log))
	reg.MustRegister(newAIProviderCapability(d.AIPresets, d.Log))
}
