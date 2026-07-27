// plugins.go —— mini-host: register the Driver's plugin capabilities (real MCP-server
// binaries run over PLAIN stdio — not bwrap; bwrap is only prod's isolation shell)
// into the launch's registry, through the SAME mcpAppCapability path prod's
// registerDiscoveredPlugins uses. The Driver names which plugin binaries to run + how
// to reach their host ops (via Env); the agent dials them like any MCP client. This is
// what lets a standalone launch assemble the full prod capability set — not just the
// in-process loaders (skill-runner / ext-mcp).

package agentcore

import (
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"
)

// PluginSpec —— a plugin the launch should assemble: a host-built MCP-server binary run
// over plain stdio. Env carries e.g. the host-op socket path the plugin dials back for
// base capabilities (corpus / booking / …). All public data — the eval module builds it.
type PluginSpec struct {
	Env     map[string]string
	ID      string
	Command string
	Args    []string
	// HostSockets —— the host-op socket paths this plugin reaches (e.g. RETRIEVAL_SOCKET).
	// Declaring them marks it a trusted DATA plugin, so the assembly hands it the session
	// context (corpus_uris scope etc.) via tool-call _meta — same gate prod uses. Empty =
	// self-contained plugin (ask-visitor), no session context. The plugin still runs over
	// plain stdio; these are NOT bound into a bwrap (that's prod isolation only).
	HostSockets  []string
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
	capload.RegisterDiscoveredPlugins(reg, manifests, capreg.OriginBuiltin, nil)
}

func pluginManifest(p *PluginSpec) mcpplugin.Manifest {
	acl := mcpplugin.ACLRoleGranted
	if p.ACLAlways {
		acl = mcpplugin.ACLAlways
	}
	transport := mcpplugin.Transport{
		Kind:    mcpplugin.TransportStdio,
		Command: p.Command,
		Args:    p.Args,
		Env:     p.Env,
	}
	// Declared host sockets → mark it a data plugin so the assembly hands it the session
	// context (sessionMetaFor gates on Sandbox.HostSockets). Kind stays TransportStdio, so
	// the dialer runs it plain — Sandbox here is metadata for the gate, not a bwrap request.
	if len(p.HostSockets) > 0 {
		transport.Sandbox = &mcpplugin.Sandbox{HostSockets: p.HostSockets}
	}
	return mcpplugin.Manifest{
		ID:           p.ID,
		Version:      mcpplugin.SupportedVersion,
		Shape:        mcpplugin.ShapeVisitorOnly,
		ACL:          acl,
		RawToolNames: p.RawToolNames,
		Transport:    transport,
	}
}
