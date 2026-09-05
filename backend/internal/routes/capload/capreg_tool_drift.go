// capreg_tool_drift.go —— reconciles the `visitor_tools` declaration in the manifest
// against what the sandbox actually answers.
//
// Why there are two copies: the source of truth for visitor tool names lives on the
// sandbox side (whatever tools/list returns on dial is what it is), yet something needs to
// ask "which tool belongs to which capability" **before dialing** — the "needs X
// connector" line on a marketplace card is exactly that (F-F-4). So the capability
// declares a copy in the manifest, and it gets reconciled once on the first dial.
//
// An unreconciled copy drifts, and nobody notices when it does: assembly keeps succeeding
// as normal, only the product starts answering that question wrong.
//
// **The real copy is still what's used for binding**: a declaration can go stale, but it
// is never allowed to change what a visitor actually gets. The judgment lives in mcpplugin
// (where the declaration lives); this file only records the conclusion.

package capload

import (
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// VisitorToolNames —— the visitor tool names declared in the manifest
// (capreg.ProvidesVisitorTools). Empty = this capability declared none, so "who owns this
// tool" can't be looked up before dialing — that's unknown, not absent.
func (c *mcpAppCapability) VisitorToolNames() []string { return c.m.VisitorTools }

// ToolRequires —— the extra dependencies **some individual tools** each name in the
// manifest (capreg.RequiresPerTool). At assembly time, this strips out the specific
// actions that can't be done while leaving the ones that can still in the same capability
// (F-B-8).
func (c *mcpAppCapability) ToolRequires() map[string][]string { return c.m.VisitorToolRequires }

// reportToolDrift —— the first dial is the moment **the real answer arrives for the first
// time**; use it to reconcile against the declaration.
func reportToolDrift(m *mcpplugin.Manifest, dialed []mcpclient.Tool) {
	drift := mcpplugin.VisitorToolDrift(m, toolNames(dialed))
	if drift.Drifted {
		slog.Default().Error(
			"capability visitor_tools declaration is stale — the sandbox offers a different set",
			"cap", m.ID,
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
