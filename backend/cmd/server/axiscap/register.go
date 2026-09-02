// register.go — composition root: registers every MCP-app capability into capreg.Registry
// (normalized). Split out of boot_wireup.go to keep it ≤350 lines.

package axiscap

import (
	"os"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"
)

// RegisterDiscoveredPlugins — registers every MCP-app capability into the same
// capreg.Registry, normalized:
//   - Built-in: code lives in its own module (mcp-servers/*), compiled to a static binary
//     shipped with the product, loaded at runtime through **the exact same** sandbox_stdio
//     path (bwrap) as third-party plugins, origin=builtin. The host doesn't import them —
//     the only contract is the manifest below (id/version/transport are data) + the runtime
//     MCP protocol.
//   - Third-party: stdio/http plugins declared by STANDMEET_PLUGINS, origin=managed. Env
//     unset → none (prod has no third-party plugins by default).
//
// All three kinds go through the same RegisterDiscoveredPlugins; only the manifest source /
// transport differs.
// depReg is built once by registerAgentSkills and set via SetDepRegistry (the ext-mcp dep
// gate and the Requires check here share the one copy): (a) at assembly time enabledCaps uses
// it to hide, via the single global gate, any cap whose Requires isn't connected (D-2); (b)
// when registering a config plugin, its Requires is checked — a plugin declaring a dependency
// name core can't supply → rejected (fail-fast, requires-boot-reject).
func RegisterDiscoveredPlugins(
	d *deps.Runtime, depReg *capreg.DepRegistry, hooks map[string]capload.CapHooks,
) {
	registerBuiltins(d, hooks) // built-in dep names are known by construction; no re-check needed
	registerPluginSource(d, os.Getenv("STANDMEET_PLUGINS"), capreg.OriginManaged, depReg)
}

// registerBuiltins — the built-in capabilities shipped with the product. Code lives in its
// own module, **compiled to a static binary and placed into the plugin directory with the
// image**; at runtime it goes through **the exact same** sandbox_stdio path (bwrap isolation)
// as third-party plugins. Normalized all the way down: builtin is left with only the
// origin=builtin label — the load mechanism has no special path at all. hooks attaches
// per-session CapHooks to the built-ins that need runtime hooks (booker: connector+quota tool
// gate; retrieval: corpus-scope fragment/enabled gate).
func registerBuiltins(d *deps.Runtime, hooks map[string]capload.CapHooks) {
	dupes := capload.RegisterDiscoveredPluginsHooked(
		d.AgentSkills, BuiltinManifests(), capreg.OriginBuiltin, hooks, capDialErrLog(d),
	)
	for _, id := range dupes {
		d.Log.Warn("builtin register skipped (duplicate id)", "id", id)
	}
}

// capDialErrLog — sounds off the real cause of a dial/list failure (e.g. sandbox won't start)
// before it collapses into ErrHidden. Shared by builtins (retrieval etc.) and third-party
// plugins. F-A-1: prod's bwrap failing to start once silently produced 0 tools.
func capDialErrLog(d *deps.Runtime) func(id string, err error) {
	return func(id string, err error) {
		d.Log.Warn("visitor capability failed to bind — hidden from this session",
			"cap", id, "err", err)
	}
}

// registerPluginSource — loads one discovery-source config and registers it under the given
// origin. A plugin declaring a named dependency core can't supply (a Requires entry naming an
// unregistered connector) → rejected + logged, rather than let it come up carrying a
// dependency it can never satisfy (fail-fast, same nature as the version gate).
func registerPluginSource(
	d *deps.Runtime, path string, origin capreg.Origin, depReg *capreg.DepRegistry,
) {
	res, err := mcpplugin.Load(path)
	if err != nil {
		d.Log.Error("plugin config load", "origin", string(origin), "err", err)
		return
	}
	for i := range res.Skipped {
		d.Log.Warn("plugin manifest skipped",
			"id", res.Skipped[i].ID, "reason", res.Skipped[i].Reason)
	}
	kept := keepResolvableDeps(d, res.Manifests, depReg)
	dupes := capload.RegisterDiscoveredPlugins(d.AgentSkills, kept, origin, capDialErrLog(d))
	for _, id := range dupes {
		d.Log.Warn("plugin register skipped (duplicate id)", "id", id)
	}
}

// keepResolvableDeps — drops any manifest that declares a named dependency core can't supply
// (a Requires entry naming an unregistered connector) + logs it; everything else is kept
// as-is (requires-boot-reject, fail-fast).
func keepResolvableDeps(
	d *deps.Runtime, manifests []mcpplugin.Manifest, depReg *capreg.DepRegistry,
) []mcpplugin.Manifest {
	kept := make([]mcpplugin.Manifest, 0, len(manifests))
	for i := range manifests {
		if unknown := depReg.Unknown(manifests[i].Requires); len(unknown) > 0 {
			d.Log.Warn("plugin register rejected (unknown required dependency)",
				"id", manifests[i].ID, "unknown_requires", unknown)
			continue
		}
		kept = append(kept, manifests[i])
	}
	return kept
}
