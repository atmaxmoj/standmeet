// Package ownercore —— #135 externalization. ALL owner-side MCP capabilities that used to be
// core-registered in mcphandle's RegisterAgentSkills now live here as one in-process plugin, using
// the jobs-plugin pattern (capabilities.CapabilityRegistrar) — no separate process/socket,
// since owner
// tools are trusted (owner-authenticated MCP facade) and need no sandbox isolation like the visitor
// leaf caps. This is what makes core zero-owner-capabilities without per-cap process overhead.
package ownercore

import (
	"log/slog"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"

	"github.com/atmaxmoj/standmeet/internal/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// Name —— plugin registry identity.
const Name = "ownercore"

// Deps —— every owner-cap's narrow dependency (was mcphandle.RegisterDeps, moved here verbatim).
type Deps struct {
	Codes            CodesRevoker
	CodeBookingQuota CodeBookingQuota
	SEO              SEOWriter
	SEOStats         seoStatsReader
	PageContent      pageContentStore
	CodeDenials      codeDenialsStore
	Owners           OwnerLookup
	Connectors       *ConnectorsOwnerDeps
	CustomPages      *owner.CustomPageDeps
	Handle           *owner.HandleDeps
	Calendar         *CalendarOwnerDeps
	Writings         *corpus.WritingsDeps
	APIKeys          *APIKeysOwnerDeps
	WritingsTx       *corpus.WritingsTxDeps
	Booking          *BookingOwnerDeps
	Conversations    *conversation.ConversationsDeps
	PublicURL        owner.PublicURLDeps
	PagePins         owner.PagePinDeps
	Corpus           *corpus.Deps
	Account          owner.AccountDeps
	BYOAI            owner.BYOAIDeps
	Log              *slog.Logger
	Ghosts           *conversation.GhostDeps
	AIPresets        []AIProviderPreset
}

// Plugin —— implements capabilities.Plugin + capabilities.CapabilityRegistrar.
type Plugin struct {
	deps *Deps
}

var (
	_ capabilities.Plugin              = (*Plugin)(nil)
	_ capabilities.CapabilityRegistrar = (*Plugin)(nil)
)

// New 构造 owner-core 插件。deps 是 boot 期一次性的 fat 依赖包，用指针避免 160B 值拷贝。
func New(deps *Deps) *Plugin { return &Plugin{deps: deps} }

// Name —— capabilities.Plugin.
func (*Plugin) Name() string { return Name }

// RegisterCapabilities —— capabilities.CapabilityRegistrar: register every owner-MCP
// capability into
// core capreg (was mcphandle.RegisterAgentSkills). dup/empty ID panics via capreg.MustRegister.
func (p *Plugin) RegisterCapabilities(reg *capreg.Registry) {
	d := p.deps
	reg.MustRegister(newMeCapability(d.Owners, d.Log))
	reg.MustRegister(newCodesCapability(d.Codes, d.CodeDenials, d.CodeBookingQuota, d.Log))
	reg.MustRegister(newSEOCapability(d.SEO, d.SEOStats, d.PagePins, d.Log))
	reg.MustRegister(newCorpusRawCapability(d.Corpus, d.SEO, d.Log))
	reg.MustRegister(newCorpusOutputCapability(d.Corpus, d.SEO, d.Log))
	reg.MustRegister(newCorpusMutationsCapability(d.Corpus, d.Log))
	reg.MustRegister(newSubjectivityCapability(d.Corpus, d.Log))
	reg.MustRegister(newChatCapability(d.Corpus, d.Conversations, d.Ghosts, d.Log))
	reg.MustRegister(newWritingsCapability(d.WritingsTx, d.Writings, d.Log))
	reg.MustRegister(newCustomPageCapability(d.CustomPages, d.Log))
	reg.MustRegister(newPageCapability(d.Handle, d.PageContent, d.PublicURL, d.PagePins, d.Log))
	reg.MustRegister(newCalendarCapability(d.Calendar.Proxy, d.Calendar.Store, d.Owners, d.Log))
	// facade-parity fills.
	// ip_bans 已搬回 security 域(security.OwnerMCPBundle),不在这里注册。
	reg.MustRegister(newAPIKeysCapability(d.APIKeys, d.Log))
	reg.MustRegister(newConnectorsCapability(d.Connectors, d.Log))
	reg.MustRegister(newBookingCapability(d.Booking, d.Log))
	reg.MustRegister(newAccountCapability(d.Account, d.Log))
	reg.MustRegister(newBYOAICapability(d.BYOAI, d.Log))
	reg.MustRegister(newAIProviderCapability(d.AIPresets, d.Log))
}
