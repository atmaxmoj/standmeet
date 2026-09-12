// mounted.go —— the mcpAppFiber adapter (a generalization of ext-mcp).
//
// This is the **MCP app (block)** category, not a skill. It dials a plugin.Manifest
// as an MCP server, calls ListTools, and wraps each tool as a BindingTool (register-style).
// skill (the Agent Skills / SKILL.md library) is a separate category (Phase C), not covered
// here.
//
// VisitorBinding: dial per transport → ListTools → wrap as BindingTool; _meta.ui goes into
// FiberState.Extra. Dial / list failure / empty tool list → ErrHidden (hidden, without
// blocking chat). A failed tool call folds into errJSON (reusing ext-mcp's makeExtMCPRun).

package mount

import (
	"context"
	"sync"

	"github.com/atmaxmoj/standmeet/internal/infra/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

type mcpAppFiber struct {
	instrOnce *sync.Once
	instr     *string
	// toolsOnce/tools —— cache the tool specs (name/desc/schema/_meta) from the first dial.
	// Tool metadata is static server-side, but re-dialing + ListTools on every VisitorBinding
	// would occasionally lose `_meta` (return_directly / progress_label) under a cold-start
	// high-load ListTools (#149), hanging ask_visitor without returning — an intermittent
	// flake. Read once; every later assembly executes on the live session but takes specs
	// from the cache, eliminating the per-dial `_meta` read race.
	toolsOnce *sync.Once
	tools     *[]mcpclient.Tool
	gate      registry.SessionGate
	// fragmentGate —— optional per-session predicate for whether this block is "actually
	// active": gates SystemPromptFragment output and FiberState.Enabled. Tool exposure is
	// unaffected (retrieval: no corpus scope → enabled=false, no prompt entry, but its 3 tools
	// stay exposed, blocked instead by internal ACL). nil = always active. Orthogonal to gate.
	fragmentGate func(*registry.AssembleInput) bool
	stateHook    StateHook
	// dialErrLog —— injected by the composition root. A dial/list failure (e.g. sandbox won't
	// start) would otherwise fold silently into ErrHidden (graceful degradation); this reports
	// the real cause first (F-A-1: prod bwrap failing to start left retrieval silently at 0
	// tools with nothing in the logs). nil = silent (old behavior).
	dialErrLog func(id string, err error)
	m          plugin.Manifest
}

// StateHook —— fills in a block's FiberState with host-computed fields (booker:
// quota_remaining). Called at assembly time; its non-zero fields (QuotaRemaining /
// PolicySummary / Extra) overlay onto the generic state.
type StateHook func(context.Context, *registry.AssembleInput) registry.FiberState

// BlockHooks —— per-session hooks the composition root attaches to a specific builtin, all
// optional and orthogonal: Gate controls tool exposure (booker: hidden by supplier+quota);
// Fragment controls prompt contribution + enabled (retrieval: no corpus scope); State fills
// in host-side-computed fields (booker: quota_remaining).
type BlockHooks struct {
	Gate     registry.SessionGate
	Fragment func(*registry.AssembleInput) bool
	State    StateHook
}

func newMCPAppFiber(m *plugin.Manifest) *mcpAppFiber {
	return &mcpAppFiber{
		m: *m, instrOnce: &sync.Once{}, instr: new(string),
		toolsOnce: &sync.Once{}, tools: new([]mcpclient.Tool),
	}
}

// The registration part (manifest → registered block, origin, ID collisions, the
// always-list) lives in register.go.

func (c *mcpAppFiber) ID() string { return c.m.ID }

// Title —— registry.Titled: the human-readable title from the plugin manifest (#109/#110
// dock-button label). Empty = no title declared (not dock-button eligible, no id fallback).
func (c *mcpAppFiber) Title() string { return c.m.Title }

func (c *mcpAppFiber) Shape() registry.Shape {
	return registry.Shape(string(c.m.Shape))
}

// Requires —— named in-app dependencies (seam names, from manifest.Requires).
// registry.enabledFibers uses this for one global gate: any unsupplied → hidden (D-2).
// Implements registry.RequiresDeps, replacing booker's hardcoded supplier-gating.
func (c *mcpAppFiber) Requires() []string { return c.m.Requires }

// SystemPromptFragment —— the server's initialize instructions ARE this block's prompt
// fragment. Gated by the same exposure gate (role-grant): a role-granted plugin
// (externalized booker / echoer / third-party) contributes only when the role grants it,
// matching booker's old in-process role-gating; ACL=always (ask_visitor / summarize) always
// contributes. The supplier/quota gate only hides the tool, not the prompt (old behavior
// preserved: role-granted-but-unconnected → fragment present, tool hidden).
func (c *mcpAppFiber) SystemPromptFragment(
	ctx context.Context, in *registry.AssembleInput,
) string {
	if !c.fragmentVisible(in) {
		return ""
	}
	// When the allowance is spent, swap in that one honest sentence instead of the "you can
	// do this" instructions — those instructions surviving while the tool is gone is exactly
	// what let the agent in F-B-14 turn around and deny its own completed work.
	return firstNonEmpty(c.spentAllowanceNote(ctx, in), c.cachedInstructions(ctx))
}

// SystemPromptFragmentID —— "blocks/<id>" when the fragment is active (same id as the
// in-process era), else empty. The frontend fetches fragment text via GET
// /api/v1/prompts/{id} by part-id to splice into the system prompt; the id no longer maps to
// an embedded .md file — the prompts endpoint falls back to the registry for this plugin's
// server initialize instructions (StaticFragment). Kept in sync with SystemPromptFragment
// (both use role-grant + fragmentActive) so part_ids match what's actually spliced in.
func (c *mcpAppFiber) SystemPromptFragmentID(
	_ context.Context, in *registry.AssembleInput,
) string {
	if !c.granted(in) || !c.fragmentActive(in) {
		return ""
	}
	return c.StaticFragmentID()
}

// StaticFragmentID —— this block's stable fragment id (session-independent); the
// registry routes GET /prompts/{id} to StaticFragment via it, matching SystemPromptFragmentID.
func (c *mcpAppFiber) StaticFragmentID() string {
	return "blocks/" + c.m.ID
}

// StaticFragment —— this block's fragment text (server initialize instructions,
// session-independent); serves externalized blocks' fragments via the prompts endpoint.
func (c *mcpAppFiber) StaticFragment(ctx context.Context) string {
	return c.cachedInstructions(ctx)
}

// VisitorBinding —— ACL gate (role grant) → dial → list → wrap. Not granted / dial / list
// failure / empty tool list → hidden. Checks the grant before dialing to skip a wasted dial.
func (c *mcpAppFiber) VisitorBinding(
	ctx context.Context, in *registry.AssembleInput,
) (*registry.Binding, error) {
	expose, gerr := c.exposable(ctx, in)
	if gerr != nil {
		return nil, gerr
	}
	if !expose {
		return nil, registry.ErrHidden
	}
	ds, derr := c.dialWithCachedSpecs(ctx, in)
	if derr != nil {
		return nil, derr
	}
	return &registry.Binding{
		Tools:     wrapMCPAppTools(ctx, &c.m, ds.sess, ds.tools, sessionMetaFor(&c.m, in)),
		State:     c.stateFor(ctx, in),
		Close:     ds.sess.Close,
		ClaimGate: claimGateOf(&c.m),
	}, nil
}

// dialWithCachedSpecs —— dial once; if the tool specs are already cached, skip ListTools.
//
// Visible on the visitor side: every tool call goes through it (a card's "send confirmation"
// click → /sessions/{id}/tools/send_confirmation → assembly → here). Tool metadata is static
// server-side and caches on the first dial, but the ListTools round trip was being paid on
// every call — especially costly right after sandbox startup, measured up to 19s under load
// (see slowAssembleThreshold in public/tools.go).
//
// The cache does not skip the dial itself: the session is stateful and gets Closed after use
// (sandbox lives one turn, see [[sandbox-lives-one-turn]]). It only skips re-asking a
// question we already know the answer to.
func (c *mcpAppFiber) dialWithCachedSpecs(
	ctx context.Context, in *registry.AssembleInput,
) (*dialedApp, error) {
	workspace := provisionWorkspaceFor(&c.m, in.ConversationID)
	if cached, known := c.knownToolSpecs(); known {
		return dialOnly(ctx, &c.m, workspace, c.dialErrLog, cached)
	}
	ds, derr := dialAndList(ctx, &c.m, workspace, c.dialErrLog)
	if derr != nil {
		return nil, derr
	}
	ds.tools = c.cachedToolSpecs(ds.tools)
	return ds, nil
}

// cachedToolSpecs —— cache the tool specs (including _meta) from the first dial and always
// return the cache after: once cached, a cold-start high-load ListTools can no longer drop
// return_directly/progress_label. Execution still uses this dial's live session; only the
// specs come from the cache.
func (c *mcpAppFiber) cachedToolSpecs(dialed []mcpclient.Tool) []mcpclient.Tool {
	c.toolsOnce.Do(func() {
		*c.tools = dialed
		reportToolDrift(&c.m, dialed)
	})
	return *c.tools
}

// knownToolSpecs —— returns (specs, true) if cached. Read-only, does not trigger Once — that
// would let the first call cache an empty slice as "known", leaving no tools forever after.
func (c *mcpAppFiber) knownToolSpecs() ([]mcpclient.Tool, bool) {
	if len(*c.tools) == 0 {
		return []mcpclient.Tool{}, false
	}
	return *c.tools, true
}

// dialOnly —— dial without calling ListTools (specs come from the cache). On failure, still
// feed the real cause to dialErrLog before folding into ErrHidden — see F-A-1.
func dialOnly(
	ctx context.Context, m *plugin.Manifest, workspaceDir string,
	dialErrLog func(id string, err error), specs []mcpclient.Tool,
) (*dialedApp, error) {
	sess, err := dialMCPApp(ctx, m, workspaceDir)
	if err != nil {
		return nil, hideWithLog(dialErrLog, m.ID, err)
	}
	return &dialedApp{sess: sess, tools: specs}, nil
}

// stateFor —— the generic mcpAppState (id/enabled) plus an optional stateHook overlay
// (booker: quota_remaining). enabled follows fragmentActive.
func (c *mcpAppFiber) stateFor(
	ctx context.Context, in *registry.AssembleInput,
) registry.FiberState {
	st := mcpAppState(&c.m, c.fragmentActive(in))
	if c.stateHook == nil {
		return st
	}
	hook := c.stateHook(ctx, in)
	overlayCapState(&st, &hook)
	return st
}

// dialedApp —— dialAndList's result (the session + its tool list), bundled into a single
// return value (revive function-result-limit ≤ 2).
type dialedApp struct {
	sess  *mcpclient.Session
	tools []mcpclient.Tool
}

// dialAndList —— dial the transport + ListTools. Dial / list failure / empty tool list all
// fold into ErrHidden; on an empty tool list, the session is closed so it doesn't leak.
func dialAndList(
	ctx context.Context, m *plugin.Manifest, workspaceDir string,
	dialErrLog func(id string, err error),
) (*dialedApp, error) {
	id := m.ID
	sess, err := dialMCPApp(ctx, m, workspaceDir)
	if err != nil {
		// Infra failure (sandbox couldn't spawn, transport unreachable). Still hide so a
		// broken plugin never blocks chat, but log the real cause first (F-A-1: this branch
		// swallowed the prod bwrap error, leaving `tools:0` unexplained).
		return nil, hideWithLog(dialErrLog, id, err)
	}
	tools, lerr := sess.ListTools(ctx)
	if lerr != nil {
		sess.Close()
		return nil, hideWithLog(dialErrLog, id, lerr)
	}
	if len(tools) == 0 { // a clean, legitimate "no tools" — hide quietly, not an error
		sess.Close()
		return nil, registry.ErrHidden
	}
	return &dialedApp{sess: sess, tools: tools}, nil
}

// hideWithLog —— feed dialErrLog the real cause first (nil-safe), then fold into ErrHidden.
// Extracted so dialAndList's cyclo stays under the limit (each error branch = one line).
func hideWithLog(dialErrLog func(id string, err error), id string, err error) error {
	if dialErrLog != nil {
		dialErrLog(id, err)
	}
	return registry.ErrHidden
}

// exposable —— the two gates before dialing: ACL (role-grant) + an optional per-session
// SessionGate (booker: seam supplied + quota). Returns (proceed, realErr): proceed=
// false → hidden (caller folds into ErrHidden); a real gate error propagates up. Checked
// before dialing to avoid the wasted sandbox dial when the plugin will be hidden anyway.
func (c *mcpAppFiber) exposable(
	ctx context.Context, in *registry.AssembleInput,
) (bool, error) {
	if !c.granted(in) {
		return false, nil
	}
	if c.gate == nil {
		return true, nil
	}
	return c.gate(ctx, in)
}

// The exposure gates — fragmentActive / fragmentVisible / mcpAppGranted / granted —
// live in mounted_gate.go. "May this speak in this session" and "how is this
// instantiated" are two questions, and this file answers the second.

// firstNonEmpty —— say the honest thing when there is one, otherwise send the instructions.
func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// cachedInstructions —— the server's initialize instructions ARE this block's
// system-prompt fragment (self-contained: declared by the server, not written in core).
// Static server-side, so read once via a lazy dial and cached; deterministic, so it isn't
// re-dialed per assembly. Whichever caller comes first, its ctx decides the one-time dial.
func (c *mcpAppFiber) cachedInstructions(ctx context.Context) string {
	c.instrOnce.Do(func() {
		// Reading instructions is a one-time, session-less dial → no workspace is allocated
		// (workspaceDir is empty).
		sess, err := dialMCPApp(ctx, &c.m, "")
		if err != nil {
			return
		}
		defer sess.Close()
		*c.instr = sess.Instructions()
	})
	return *c.instr
}

// sessionMetaFor / roleIDOf / maxBookingsOf / corpusScopeOf —— see session.go
// (split out to keep this file under max-lines ≤350).
