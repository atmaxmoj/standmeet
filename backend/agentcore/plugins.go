// plugins.go —— mini-host: register the Driver's plugin blocks (real MCP-server
// binaries run over PLAIN stdio — not bwrap; bwrap is only prod's isolation shell)
// into the launch's registry, through the SAME mcpAppFiber path prod's
// registerDiscoveredPlugins uses. The Driver names which plugin binaries to run + how
// to reach their host ops (via Env); the agent dials them like any MCP client. This is
// what lets a standalone launch assemble the full prod block set — not just the
// in-process loaders (skill-runner / ext-mcp).

package agentcore

import (
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/mount"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// PluginSpec —— a plugin the launch should assemble: a host-built MCP-server binary run
// over plain stdio. Env carries e.g. the host-op socket path the plugin dials back for
// base blocks (corpus / booking / …). All public data — the eval module builds it.
type PluginSpec struct {
	Env     map[string]string
	ID      string
	Command string
	Args    []string
	// HostOps —— the host ops this plugin reaches back for, BY NAME (same vocabulary prod's
	// manifests order from: "corpus_search", "conversation.read", …). Declaring any marks it
	// a trusted DATA plugin, so the assembly hands it the session context (corpus_uris scope
	// etc.) via tool-call _meta — same gate prod uses. Empty = self-contained plugin
	// (ask-visitor), no session context. In the mini-host the plugin runs over plain stdio
	// and finds its socket through Env; nothing is bound into a bwrap (prod isolation only).
	HostOps      []string
	RawToolNames bool
	ACLAlways    bool
}

// registerDriverPlugins —— register the Driver's plugins as mcpAppFibers (plain
// stdio transport), origin=builtin, same path prod uses.
func registerDriverPlugins(reg *registry.Registry, specs []PluginSpec) {
	if len(specs) == 0 {
		return
	}
	manifests := make([]plugin.Manifest, 0, len(specs))
	for i := range specs {
		manifests = append(manifests, pluginManifest(&specs[i]))
	}
	mount.RegisterDiscoveredPlugins(reg, manifests, registry.OriginBuiltin, nil)
}

func pluginManifest(p *PluginSpec) plugin.Manifest {
	acl := plugin.ACLRoleGranted
	if p.ACLAlways {
		acl = plugin.ACLAlways
	}
	transport := plugin.Transport{
		Kind:    plugin.TransportStdio,
		Command: p.Command,
		Args:    p.Args,
		Env:     p.Env,
	}
	// Declared host ops → mark it a data plugin so the assembly hands it the session
	// context (sessionMetaFor gates on Sandbox.HostOps). Kind stays TransportStdio, so
	// the dialer runs it plain — Sandbox here is metadata for the gate, not a bwrap request.
	if len(p.HostOps) > 0 {
		transport.Sandbox = &plugin.Sandbox{HostOps: p.HostOps}
	}
	return plugin.Manifest{
		ID:           p.ID,
		Version:      plugin.SupportedVersion,
		Shape:        plugin.ShapeVisitorOnly,
		ACL:          acl,
		RawToolNames: p.RawToolNames,
		Transport:    transport,
	}
}
