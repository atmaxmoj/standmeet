// plugins.go —— mini-host: register the Driver's plugin capabilities (real MCP-server
// binaries run over PLAIN stdio — not bwrap; bwrap is only prod's isolation shell)
// into the launch's registry, through the SAME mcpAppCapability path prod's
// registerDiscoveredPlugins uses. The Driver names which plugin binaries to run + how
// to reach their host ops (via Env); the agent dials them like any MCP client. This is
// what lets a standalone launch assemble the full prod capability set — not just the
// in-process loaders (skill-runner / ext-mcp).

package agentcore

import (
	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// PluginSpec —— a plugin the launch should assemble: a host-built MCP-server binary run
// over plain stdio. Env carries e.g. the host-op socket path the plugin dials back for
// base capabilities (corpus / booking / …). All public data — the eval module builds it.
type PluginSpec struct {
	Env          map[string]string
	ID           string
	Command      string
	Args         []string
	RawToolNames bool
	ACLAlways    bool
}

// registerDriverPlugins —— register the Driver's plugins as mcpAppCapabilities (plain
// stdio transport), origin=builtin, same path prod uses.
func registerDriverPlugins(reg *capreg.Registry, specs []PluginSpec) {
	if len(specs) == 0 {
		return
	}
	manifests := make([]mcpplugin.Manifest, 0, len(specs))
	for i := range specs {
		manifests = append(manifests, pluginManifest(&specs[i]))
	}
	usecases.RegisterDiscoveredPlugins(reg, manifests, capreg.OriginBuiltin)
}

func pluginManifest(p *PluginSpec) mcpplugin.Manifest {
	acl := mcpplugin.ACLRoleGranted
	if p.ACLAlways {
		acl = mcpplugin.ACLAlways
	}
	return mcpplugin.Manifest{
		ID:           p.ID,
		Version:      mcpplugin.SupportedVersion,
		Shape:        mcpplugin.ShapeVisitorOnly,
		ACL:          acl,
		RawToolNames: p.RawToolNames,
		Transport: mcpplugin.Transport{
			Kind:    mcpplugin.TransportStdio,
			Command: p.Command,
			Args:    p.Args,
			Env:     p.Env,
		},
	}
}
