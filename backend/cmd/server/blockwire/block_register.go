// block_register.go — composition root: registers every MCP-app block into registry.Registry
// (normalized). Split out of boot_wireup.go to keep it ≤350 lines.

package blockwire

import (
	"context"
	"os"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/cmd/server/port"

	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/assembly"
	"github.com/atmaxmoj/standmeet/internal/plugin/mount"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// RegisterDiscoveredPlugins — registers every MCP-app block into the same
// registry.Registry, normalized:
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
// gate and the Requires check here share the one copy): (a) at assembly time enabledFibers
// uses it to hide, via the single global gate, any block whose Requires isn't connected (D-2);
// (b) when registering a config plugin, its Requires is checked — a plugin declaring a
// dependency name core can't supply → rejected (fail-fast, requires-boot-reject).
func RegisterDiscoveredPlugins(
	d *deps.Runtime, depReg *registry.DepRegistry, hooks map[string]mount.BlockHooks,
) {
	registerBuiltins(d, hooks) // built-in dep names are known by construction; no re-check needed
	registerPluginSource(d, os.Getenv("STANDMEET_PLUGINS"), registry.OriginManaged, depReg)
}

// registerBuiltins — the built-in blocks shipped with the product. Code lives in its
// own module, **compiled to a static binary and placed into the plugin directory with the
// image**; at runtime it goes through **the exact same** sandbox_stdio path (bwrap isolation)
// as third-party plugins. Normalized all the way down: builtin is left with only the
// origin=builtin label — the load mechanism has no special path at all. hooks attaches
// per-session BlockHooks to the built-ins that need runtime hooks (booker: supplier+quota tool
// gate; retrieval: corpus-scope fragment/enabled gate).
func registerBuiltins(d *deps.Runtime, hooks map[string]mount.BlockHooks) {
	ms := BlockManifests()
	noteBlock(ms)
	dupes := mount.RegisterDiscoveredPluginsHooked(
		d.AgentSkills, ms, registry.OriginBuiltin, hooks, blockDialErrLog(d),
	)
	for _, id := range dupes {
		d.Log.Warn("builtin register skipped (duplicate id)", "id", id)
	}
}

// blockDialErrLog — the owner's third face of a failure, and the log line that used to be
// its only face.
//
// F-A-1: prod's bwrap failing to start once silently produced 0 tools. The log line was
// added then, and on 2026-09-08 it proved not to be enough — a plugin died at import,
// this line was written, and **the owner was shown nothing at all**. A block that
// silently is not there is indistinguishable from a block that was never installed, so
// `tests.md` §3 asks for a persistent entry naming the block and carrying the child's
// stderr. `err` already contains that stderr: `mcpclient.childStderr` quotes it into the
// dial error precisely so it survives to here.
//
// Recording is best-effort and never blocks the visitor's path: this runs while a
// session is being assembled, the block is already being hidden, and a failure to
// write down WHY must not become a second failure the visitor can feel.
func blockDialErrLog(d *deps.Runtime) func(id string, err error) {
	return func(id string, err error) {
		d.Log.Warn("visitor block failed to bind — hidden from this session",
			"block", id, "err", err)
		recordBlockFailure(d, id, err)
	}
}

// recordBlockFailure — persist one failure against the owner.
//
// The sole owner, resolved here rather than threaded through the dial hook. The hook is
// called from deep inside assembly and knows only "which block, and why"; widening its
// signature to carry an owner would push a v1 single-tenant assumption through four
// layers of plugin code that is otherwise owner-agnostic. When this instance becomes
// multi-tenant the assumption is in one function, which is where it can be seen.
//
// The context is a fresh one, not the visitor's, and that is the point: this write records WHY
// a block vanished from the session being assembled. Inheriting the caller's context would
// cancel the record at exactly the moment it matters — the assembly that failed — leaving the
// owner with the same silence the entry exists to end. Its own short budget bounds it instead.
func recordBlockFailure(d *deps.Runtime, id string, err error) {
	if d.Assembly == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), failureWriteTimeout)
	defer cancel()
	ownerID, oerr := port.NewSoleOwnerLookup(d).SoleOwnerID(ctx)
	if oerr != nil || ownerID == "" {
		return // not claimed yet: there is nobody to tell
	}
	f := assembly.Failure{
		BlockID: id, Title: blockTitle(ctx, d, ownerID, id), Stderr: err.Error(),
	}
	if werr := d.Assembly.RecordFailure(ctx, ownerID, &f); werr != nil {
		d.Log.Warn("record block failure", "block", id, "err", werr)
	}
}

// failureWriteTimeout — this write is on the visitor's assembly path; it gets a short
// budget and then gives up, because the visitor is waiting for a session.
const failureWriteTimeout = 2 * time.Second

// blockTitle — the block's own declared title, so the owner reads "Acme Broken" rather
// than "acme.broken.zzfixture".
//
// Built-ins first because they are in memory; an installed block's title is in its row.
// Falls back to the id, which is never nothing: a block that declared no title still has
// to be nameable in the entry, and an entry that names nothing is the failure this whole
// mechanism exists to replace.
func blockTitle(ctx context.Context, d *deps.Runtime, ownerID, id string) string {
	// Indexed rather than ranged by value: a Manifest is ~576 bytes, and this runs on the
	// visitor's assembly path.
	ms := BuiltinManifests()
	for i := range ms {
		if ms[i].ID == id && ms[i].Title != "" {
			return ms[i].Title
		}
	}
	if t := d.Assembly.TitleOf(ctx, ownerID, id); t != "" {
		return t
	}
	return id
}

// registerPluginSource — loads one discovery-source config and registers it under the given
// origin. A plugin declaring a named dependency core can't supply (a Requires entry naming an
// unregistered seam) → rejected + logged, rather than let it come up carrying a
// dependency it can never satisfy (fail-fast, same nature as the version gate).
func registerPluginSource(
	d *deps.Runtime, path string, origin registry.Origin, depReg *registry.DepRegistry,
) {
	res, err := plugin.LoadOwnerSource(path)
	if err != nil {
		d.Log.Error("plugin config load", "origin", string(origin), "err", err)
		return
	}
	for i := range res.Skipped {
		d.Log.Warn("plugin manifest skipped",
			"id", res.Skipped[i].ID, "reason", res.Skipped[i].Reason)
	}
	kept := keepResolvableDeps(d, res.Manifests, depReg)
	noteBlock(kept)
	dupes := mount.RegisterDiscoveredPlugins(d.AgentSkills, kept, origin, blockDialErrLog(d))
	for _, id := range dupes {
		d.Log.Warn("plugin register skipped (duplicate id)", "id", id)
	}
}

// keepResolvableDeps — drops any manifest that declares a named dependency core can't supply
// (a Requires entry naming an unregistered seam) + logs it; everything else is kept
// as-is (requires-boot-reject, fail-fast).
func keepResolvableDeps(
	d *deps.Runtime, manifests []plugin.Manifest, depReg *registry.DepRegistry,
) []plugin.Manifest {
	kept := make([]plugin.Manifest, 0, len(manifests))
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
