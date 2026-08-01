// Package ownercore —— #135 externalization. ALL owner-side MCP capabilities that used to be
// core-registered in mcphandle's RegisterAgentSkills now live here as one in-process plugin, using
// the jobs-plugin pattern (capabilities.CapabilityRegistrar) — no separate process/socket,
// since owner
// tools are trusted (owner-authenticated MCP facade) and need no sandbox isolation like the visitor
// leaf caps. This is what makes core zero-owner-capabilities without per-cap process overhead.
package ownercore

import (
	"log/slog"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"

	"github.com/atmaxmoj/standmeet/internal/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// Name —— plugin registry identity.
const Name = "ownercore"

// Deps —— every owner-cap's narrow dependency (was mcphandle.RegisterDeps, moved here verbatim).
type Deps struct {
	SEO        SEOWriter
	Connectors *ConnectorsOwnerDeps
	Writings   *corpus.WritingsDeps
	APIKeys    *APIKeysOwnerDeps
	WritingsTx *corpus.WritingsTxDeps
	Corpus     *corpus.Deps
	Log        *slog.Logger
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
	reg.MustRegister(newCorpusRawCapability(d.Corpus, d.SEO, d.Log))
	reg.MustRegister(newCorpusOutputCapability(d.Corpus, d.SEO, d.Log))
	reg.MustRegister(newCorpusMutationsCapability(d.Corpus, d.Log))
	reg.MustRegister(newWritingsCapability(d.WritingsTx, d.Writings, d.Log))
	// facade-parity fills.
	// ip_bans 已搬回 security 域(security.OwnerMCPBundle),不在这里注册。
	reg.MustRegister(newAPIKeysCapability(d.APIKeys, d.Log))
	reg.MustRegister(newConnectorsCapability(d.Connectors, d.Log))
}
