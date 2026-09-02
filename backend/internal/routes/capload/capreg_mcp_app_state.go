// capreg_mcp_app_state.go —— mcpAppCapability's tool-wrapping + CapabilityState sub-concern:
// wraps the dialed MCP tools as capreg.BindingTool, and assembles CapabilityState
// (id/enabled/ui + stateHook overlay). Split out of capreg_mcp_app.go to keep it under the
// max-lines 350 cap.

package capload

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// KnownToolNames —— capreg.ToolNameKnower: once specs are cached from the first dial, this
// can name its exposed tools without dialing. Names go through composeMCPAppToolName — the
// same function wrapMCPAppTools uses, not a second copy of the naming logic (a second copy
// would silently drift out of sync the day the prefix rule changes, and this capability
// would go silently skipped). The second return value false = not dialed yet, so the caller
// has no choice but to dial for real.
func (c *mcpAppCapability) KnownToolNames() ([]string, bool) {
	specs, known := c.knownToolSpecs()
	if !known {
		return []string{}, false
	}
	return composeMCPAppToolNames(&c.m, specs), true
}

// composeMCPAppToolNames —— specs → the exposed tool names (empty ones dropped, matching
// wrapMCPAppTools).
func composeMCPAppToolNames(m *mcpplugin.Manifest, specs []mcpclient.Tool) []string {
	names := make([]string, 0, len(specs))
	for i := range specs {
		if name := composeMCPAppToolName(m, specs[i].Name); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// VisitorStateOnly —— capreg.StateReporter: reports state without starting the sandbox.
//
// This runs through the exact **same** exposable gate (role grant + SessionGate's
// connector/quota), so a cascade like "the button greys out the instant the last slot is
// booked" matches the dial path word for word. What's skipped is only the cost of starting
// a sandbox and then closing it, just to get {id,enabled,quota}.
//
// The one difference from VisitorBinding: when the sandbox fails to start, this still
// reports enabled (the dial path would hide it). That's an infra fault, not the owner's
// configured intent — making the button vanish would only confuse the visitor, whereas
// clicking it and getting a "tool failed" receipt is clearer.
func (c *mcpAppCapability) VisitorStateOnly(
	ctx context.Context, in *capreg.AssembleInput,
) (capreg.CapabilityState, bool) {
	expose, gerr := c.exposable(ctx, in)
	if gerr != nil || !expose {
		return capreg.CapabilityState{}, false
	}
	return c.stateFor(ctx, in), true
}

func wrapMCPAppTools(
	ctx context.Context, m *mcpplugin.Manifest, sess *mcpclient.Session,
	tools []mcpclient.Tool, sessionMeta *mcpclient.SessionContext,
) []capreg.BindingTool {
	out := make([]capreg.BindingTool, 0, len(tools))
	uiCache := map[string]string{} // per-assembly dedup of resources/read (same uri read only once)
	for i := range tools {
		t := &tools[i]
		name := composeMCPAppToolName(m, t.Name)
		if name == "" {
			continue
		}
		bt := capreg.NewTool(
			name,
			mcpAppToolDescription(m.ID, t),
			toolProgressLabel(m, t),
			t.InputSchema,
			makeExtMCPRun(sess, t.Name, sessionMeta, toolCallBudget(t)),
		)
		// ReturnDirectly —— declared by the server via tool `_meta.return_directly`: once
		// called, end the agent loop right away and push the result to the browser as
		// final (the same semantics as ask_visitor).
		if toolReturnsDirectly(t) {
			bt.ReturnDirectly = true
		}
		// UIHTML —— MCP Apps: a ui card attached to the tool (`_meta.ui_resource`). Its
		// HTML is read at assembly time.
		bt.UIHTML = toolUIHTML(ctx, sess, t, uiCache)
		// ReadOnly —— the server's `annotations.readOnlyHint`: a safe read-only tool may go
		// via HTTP QUERY.
		bt.ReadOnly = t.ReadOnly
		out = append(out, bt)
	}
	return out
}

// toolReturnsDirectly —— reads the return_directly a server declares in a tool's `_meta`.
func toolReturnsDirectly(t *mcpclient.Tool) bool {
	v, ok := t.Meta["return_directly"].(bool)
	return ok && v
}

// toolCallBudget —— per-tool CallTool budget. A tool that does a full LLM round-trip itself
// declares `_meta.long_running`; it gets LongCallTimeout instead of the generic 15s cap that
// would otherwise cut a report generation off mid-flight (F-A-6). 0 = the default budget.
func toolCallBudget(t *mcpclient.Tool) time.Duration {
	if v, ok := t.Meta["long_running"].(bool); ok && v {
		return mcpclient.LongCallTimeout
	}
	return 0
}

// toolUIHTML —— reads the ui:// card HTML pointed to by a tool's `_meta.ui_resource`
// (per-tool, matching MCP Apps). Not declared → empty (no card); unreadable → empty
// (degrades gracefully, without blocking chat). Same uri goes through the cache.
func toolUIHTML(
	ctx context.Context, sess *mcpclient.Session, t *mcpclient.Tool, cache map[string]string,
) string {
	uri, ok := t.Meta["ui_resource"].(string)
	if !ok || uri == "" {
		return ""
	}
	if html, hit := cache[uri]; hit {
		return html
	}
	html, err := sess.ReadResource(ctx, uri)
	if err != nil {
		// Failing to read isn't fatal (the card degrades gracefully, without blocking chat),
		// but it's still logged — never swallowed silently.
		slog.Default().Warn("read ui card resource", "tool", t.Name, "uri", uri, "err", err)
		return ""
	}
	cache[uri] = html
	return html
}

// toolProgressLabel —— the throbber text a server declares in a tool's
// `_meta.progress_label` (externalized builtins keep their own original text:
// corpus_search's "searching corpus" etc). Not declared → falls back to the manifest's
// Title.
//
// **Which sentence gets used belongs to `mcpplugin.ProgressLabel`** — that's the
// capability's own property ("what am I doing" should be answered by whatever declares
// this capability), not the loader's decision. This function only pulls out what the tool
// declared and passes it along. The routes-cyclo gate is what first caught this
// misattribution: what it blocks is "a branch growing inside a face", and the branch was
// there in the first place because this judgment never belonged at this layer.
func toolProgressLabel(m *mcpplugin.Manifest, t *mcpclient.Tool) string {
	declared, ok := t.Meta["progress_label"].(string)
	if !ok {
		declared = ""
	}
	return mcpplugin.ProgressLabel(m, declared)
}

// composeMCPAppToolName —— when RawToolNames is set, use the server's original name
// (externalized builtins keep their canonical name); otherwise add an <id>_ prefix (to
// prevent name collisions across multiple third-party servers).
func composeMCPAppToolName(m *mcpplugin.Manifest, tool string) string {
	if m.RawToolNames {
		return sanitizeToolName(tool)
	}
	return sanitizeToolName(m.ID + "_" + tool)
}

func mcpAppToolDescription(pluginID string, t *mcpclient.Tool) string {
	prefix := "[" + pluginID + "] "
	if t.Description == "" {
		return prefix + t.Name
	}
	return prefix + strings.TrimSpace(t.Description)
}

// overlayCapState —— overlays stateHook's non-zero fields onto the generic state
// (id/enabled left untouched).
func overlayCapState(dst, extra *capreg.CapabilityState) {
	if extra.QuotaRemaining != nil {
		dst.QuotaRemaining = extra.QuotaRemaining
	}
	if extra.PolicySummary != "" {
		dst.PolicySummary = extra.PolicySummary
	}
	if len(extra.Extra) > 0 {
		dst.Extra = extra.Extra
	}
}

// mcpAppState —— the generic CapabilityState (id/enabled). #134: the ui card has moved to
// per-tool (tool `_meta.ui_resource` → tool_spec.UIHTML) and is no longer attached to the
// capability.
func mcpAppState(m *mcpplugin.Manifest, enabled bool) capreg.CapabilityState {
	return capreg.CapabilityState{ID: m.ID, Enabled: enabled}
}
