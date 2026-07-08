// Package ownercore —— #135 externalization. Owner-side capabilities that used to be
// core-registered in mcphandle's RegisterAgentSkills move here as an in-process plugin, using the
// same pattern as the jobs plugin (plugins.CapabilityRegistrar) — no separate process/socket, since
// owner tools are trusted (owner-authenticated MCP facade) and need no sandbox isolation like the
// visitor leaf caps. This achieves core-zero-capabilities without per-cap process overhead.
//
// The pilot holds `me`; codes / chat / calendar join this same plugin by domain (the owner-core
// bundle) in later slices.
package ownercore

import (
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/plugins"
)

// Name —— plugin registry identity.
const Name = "ownercore"

// Deps —— the narrow dependencies the owner-core capabilities need.
type Deps struct {
	Owners OwnerLookup
	Codes  CodesRevoker
	Log    *slog.Logger
}

// Plugin —— implements plugins.Plugin + plugins.CapabilityRegistrar.
type Plugin struct {
	deps Deps
}

var (
	_ plugins.Plugin              = (*Plugin)(nil)
	_ plugins.CapabilityRegistrar = (*Plugin)(nil)
)

// New 构造 owner-core 插件。
func New(deps Deps) *Plugin { return &Plugin{deps: deps} }

// Name —— plugins.Plugin.
func (*Plugin) Name() string { return Name }

// RegisterCapabilities —— plugins.CapabilityRegistrar: register the owner-core owner-MCP
// capabilities into core capreg (dup ID / empty ID panics via capreg.MustRegister — boot-fail beats
// a silently-missing tool).
func (p *Plugin) RegisterCapabilities(reg *capreg.Registry) {
	reg.MustRegister(newMeCapability(p.deps.Owners, p.deps.Log))
	reg.MustRegister(newCodesCapability(p.deps.Codes, p.deps.Log))
}
