// tool_drift.go —— reconciles the `visitor_tools` declaration in the manifest
// against what the sandbox actually answers.
//
// Why there are two copies: the source of truth for visitor tool names lives on the
// sandbox side (whatever tools/list returns on dial is what it is), yet something needs to
// ask "which tool belongs to which block" **before dialing** — the "needs X
// supplier" line on a marketplace card is exactly that (F-F-4). So the block
// declares a copy in the manifest, and it gets reconciled once on the first dial.
//
// An unreconciled copy drifts, and nobody notices when it does: assembly keeps succeeding
// as normal, only the product starts answering that question wrong.
//
// **The real copy is still what's used for binding**: a declaration can go stale, but it
// is never allowed to change what a visitor actually gets. The judgment lives in mcpplugin
// (where the declaration lives); this file only records the conclusion.

package mount

import (
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/infra/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/plugin"
)

// VisitorToolNames —— the visitor tool names declared in the manifest
// (registry.ProvidesVisitorTools). Empty = this block declared none, so "who owns this
// tool" can't be looked up before dialing — that's unknown, not absent.
func (c *mcpAppFiber) VisitorToolNames() []string {
	return plugin.VisitorToolNames(c.m.VisitorTools)
}

// ToolRequires —— the extra dependencies **some individual tools** each name in the
// manifest (registry.RequiresPerTool). At assembly time, this strips out the specific
// actions that can't be done while leaving the ones that can still in the same block
// (F-B-8).
func (c *mcpAppFiber) ToolRequires() map[string][]string { return c.m.VisitorToolRequires() }

// reportToolDrift —— the first dial is the moment **the real answer arrives for the first
// time**; use it to reconcile against the declaration.
func reportToolDrift(m *plugin.Manifest, dialed []mcpclient.Tool) {
	drift := plugin.VisitorToolDrift(m, toolNames(dialed))
	if drift.Drifted {
		slog.Default().Error(
			"block visitor_tools declaration is stale — the sandbox offers a different set",
			"block", m.ID,
			"declared_but_absent", drift.DeclaredButAbsent,
			"offered_but_undeclared", drift.OfferedButUndeclared,
		)
	}
}

func toolNames(dialed []mcpclient.Tool) []string {
	out := make([]string, 0, len(dialed))
	for i := range dialed {
		out = append(out, dialed[i].Name)
	}
	return out
}
