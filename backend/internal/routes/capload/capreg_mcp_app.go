// capreg_mcp_app.go —— C3: the mcpAppCapability adapter (a generalization of ext-mcp).
//
// This is the **MCP app (capability)** category, not a skill. It dials a mcpplugin.Manifest
// as an MCP server, calls ListTools, and wraps each tool as a BindingTool (register-style).
// skill (the Agent Skills / SKILL.md library) is a separate category (Phase C), not covered
// here.
//
// VisitorBinding: dial per transport → ListTools → wrap as BindingTool; _meta.ui goes into
// CapabilityState.Extra. Dial / list failure / empty tool list → ErrHidden (hidden, without
// blocking chat). A failed tool call folds into errJSON (reusing ext-mcp's makeExtMCPRun).

package capload

import (
	"context"
	"sync"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

type mcpAppCapability struct {
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
	gate      capreg.SessionGate
	// fragmentGate —— optional per-session predicate for whether this capability is "actually
	// active": gates SystemPromptFragment output and CapabilityState.Enabled. Tool exposure is
	// unaffected (retrieval: no corpus scope → enabled=false, no prompt entry, but its 3 tools
	// stay exposed, blocked instead by internal ACL). nil = always active. Orthogonal to gate.
	fragmentGate func(*capreg.AssembleInput) bool
	stateHook    StateHook
	// dialErrLog —— injected by the composition root. A dial/list failure (e.g. sandbox won't
	// start) would otherwise fold silently into ErrHidden (graceful degradation); this reports
	// the real cause first (F-A-1: prod bwrap failing to start left retrieval silently at 0
	// tools with nothing in the logs). nil = silent (old behavior).
	dialErrLog func(id string, err error)
	m          mcpplugin.Manifest
}

// StateHook —— fills in a capability's CapabilityState with host-computed fields (booker:
// quota_remaining). Called at assembly time; its non-zero fields (QuotaRemaining /
// PolicySummary / Extra) overlay onto the generic state.
type StateHook func(context.Context, *capreg.AssembleInput) capreg.CapabilityState

// CapHooks —— per-session hooks the composition root attaches to a specific builtin, all
// optional and orthogonal: Gate controls tool exposure (booker: hidden by connector+quota);
// Fragment controls prompt contribution + enabled (retrieval: no corpus scope); State fills
// in host-side-computed fields (booker: quota_remaining).
type CapHooks struct {
	Gate     capreg.SessionGate
	Fragment func(*capreg.AssembleInput) bool
	State    StateHook
}

func newMCPAppCapability(m *mcpplugin.Manifest) *mcpAppCapability {
	return &mcpAppCapability{
		m: *m, instrOnce: &sync.Once{}, instr: new(string),
		toolsOnce: &sync.Once{}, tools: new([]mcpclient.Tool),
	}
}

// The registration part (manifest → registered capability, origin, ID collisions, the
// always-list) lives in capreg_mcp_app_register.go.

func (c *mcpAppCapability) ID() string { return c.m.ID }

// Title —— capreg.Titled: the human-readable title from the plugin manifest (#109/#110
// dock-button label). Empty = no title declared (not dock-button eligible, no id fallback).
func (c *mcpAppCapability) Title() string { return c.m.Title }

func (c *mcpAppCapability) Shape() capreg.Shape {
	return capreg.Shape(string(c.m.Shape))
}

// Requires —— named in-app dependencies (connector names, from manifest.Requires).
// capreg.enabledCaps uses this for one global gate: any unconnected → hidden (D-2).
// Implements capreg.RequiresDeps, replacing booker's hardcoded connector-gating.
func (c *mcpAppCapability) Requires() []string { return c.m.Requires }

// SystemPromptFragment —— the server's initialize instructions ARE this capability's prompt
// fragment. Gated by the same exposure gate (role-grant): a role-granted plugin
// (externalized booker / echoer / third-party) contributes only when the role grants it,
// matching booker's old in-process role-gating; ACL=always (ask_visitor / summarize) always
// contributes. The connector/quota gate only hides the tool, not the prompt (old behavior
// preserved: role-granted-but-unconnected → fragment present, tool hidden).
func (c *mcpAppCapability) SystemPromptFragment(
	ctx context.Context, in *capreg.AssembleInput,
) string {
	if !c.fragmentVisible(in) {
		return ""
	}
	// When the allowance is spent, swap in that one honest sentence instead of the "you can
	// do this" instructions — those instructions surviving while the tool is gone is exactly
	// what let the agent in F-B-14 turn around and deny its own completed work.
	return firstNonEmpty(c.spentAllowanceNote(ctx, in), c.cachedInstructions(ctx))
}

// SystemPromptFragmentID —— "capabilities/<id>" when the fragment is active (same id as the
// in-process era), else empty. The frontend fetches fragment text via GET
// /api/v1/prompts/{id} by part-id to splice into the system prompt; the id no longer maps to
// an embedded .md file — the prompts endpoint falls back to the registry for this plugin's
// server initialize instructions (StaticFragment). Kept in sync with SystemPromptFragment
// (both use role-grant + fragmentActive) so part_ids match what's actually spliced in.
func (c *mcpAppCapability) SystemPromptFragmentID(
	_ context.Context, in *capreg.AssembleInput,
) string {
	if !mcpAppGranted(&c.m, in.RoleSnapshot) || !c.fragmentActive(in) {
		return ""
	}
	return c.StaticFragmentID()
}

// StaticFragmentID —— this capability's stable fragment id (session-independent); the
// registry routes GET /prompts/{id} to StaticFragment via it, matching SystemPromptFragmentID.
func (c *mcpAppCapability) StaticFragmentID() string {
	return "capabilities/" + c.m.ID
}

// StaticFragment —— this capability's fragment text (server initialize instructions,
// session-independent); serves externalized capabilities' fragments via the prompts endpoint.
func (c *mcpAppCapability) StaticFragment(ctx context.Context) string {
	return c.cachedInstructions(ctx)
}

// VisitorBinding —— ACL gate (role grant) → dial → list → wrap. Not granted / dial / list
// failure / empty tool list → hidden. Checks the grant before dialing to skip a wasted dial.
func (c *mcpAppCapability) VisitorBinding(
	ctx context.Context, in *capreg.AssembleInput,
) (*capreg.Binding, error) {
	expose, gerr := c.exposable(ctx, in)
	if gerr != nil {
		return nil, gerr
	}
	if !expose {
		return nil, capreg.ErrHidden
	}
	ds, derr := c.dialWithCachedSpecs(ctx, in)
	if derr != nil {
		return nil, derr
	}
	return &capreg.Binding{
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
func (c *mcpAppCapability) dialWithCachedSpecs(
	ctx context.Context, in *capreg.AssembleInput,
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
func (c *mcpAppCapability) cachedToolSpecs(dialed []mcpclient.Tool) []mcpclient.Tool {
	c.toolsOnce.Do(func() {
		*c.tools = dialed
		reportToolDrift(&c.m, dialed)
	})
	return *c.tools
}

// knownToolSpecs —— returns (specs, true) if cached. Read-only, does not trigger Once — that
// would let the first call cache an empty slice as "known", leaving no tools forever after.
func (c *mcpAppCapability) knownToolSpecs() ([]mcpclient.Tool, bool) {
	if len(*c.tools) == 0 {
		return []mcpclient.Tool{}, false
	}
	return *c.tools, true
}

// dialOnly —— dial without calling ListTools (specs come from the cache). On failure, still
// feed the real cause to dialErrLog before folding into ErrHidden — see F-A-1.
func dialOnly(
	ctx context.Context, m *mcpplugin.Manifest, workspaceDir string,
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
func (c *mcpAppCapability) stateFor(
	ctx context.Context, in *capreg.AssembleInput,
) capreg.CapabilityState {
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
	ctx context.Context, m *mcpplugin.Manifest, workspaceDir string,
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
		return nil, capreg.ErrHidden
	}
	return &dialedApp{sess: sess, tools: tools}, nil
}

// hideWithLog —— feed dialErrLog the real cause first (nil-safe), then fold into ErrHidden.
// Extracted so dialAndList's cyclo stays under the limit (each error branch = one line).
func hideWithLog(dialErrLog func(id string, err error), id string, err error) error {
	if dialErrLog != nil {
		dialErrLog(id, err)
	}
	return capreg.ErrHidden
}

// exposable —— the two gates before dialing: ACL (role-grant) + an optional per-session
// SessionGate (booker: connector-connected + quota). Returns (proceed, realErr): proceed=
// false → hidden (caller folds into ErrHidden); a real gate error propagates up. Checked
// before dialing to avoid the wasted sandbox dial when the plugin will be hidden anyway.
func (c *mcpAppCapability) exposable(
	ctx context.Context, in *capreg.AssembleInput,
) (bool, error) {
	if !mcpAppGranted(&c.m, in.RoleSnapshot) {
		return false, nil
	}
	if c.gate == nil {
		return true, nil
	}
	return c.gate(ctx, in)
}

// fragmentActive —— the fragmentGate predicate (retrieval: has a corpus scope). nil =
// always active. Controls prompt fragment contribution + CapabilityState.Enabled.
func (c *mcpAppCapability) fragmentActive(in *capreg.AssembleInput) bool {
	return c.fragmentGate == nil || c.fragmentGate(in)
}

// fragmentVisible —— whether this capability gets to speak in this session (role-granted
// + fragment active).
func (c *mcpAppCapability) fragmentVisible(in *capreg.AssembleInput) bool {
	return mcpAppGranted(&c.m, in.RoleSnapshot) && c.fragmentActive(in)
}

// firstNonEmpty —— say the honest thing when there is one, otherwise send the instructions.
func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// cachedInstructions —— the server's initialize instructions ARE this capability's
// system-prompt fragment (self-contained: declared by the server, not written in core).
// Static server-side, so read once via a lazy dial and cached; deterministic, so it isn't
// re-dialed per assembly. Whichever caller comes first, its ctx decides the one-time dial.
func (c *mcpAppCapability) cachedInstructions(ctx context.Context) string {
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

// mcpAppGranted —— the exposure gate. ACL=always → exposed unconditionally to every mode
// (an externalized builtin base capability, like ask_visitor). Otherwise role-granted: only
// exposed when the role's AllowedTools contains this plugin's ID (echoer / third-party
// server); no role (public/byoai) → hidden.
func mcpAppGranted(m *mcpplugin.Manifest, snap *access.RoleSnapshot) bool {
	always := m.ACL == mcpplugin.ACLAlways
	if snap == nil {
		return always // no snapshot: no code-deny source, so only always-capabilities show
	}
	// The frozen three-tier judgment (the live-gate is computed separately in enabledCaps).
	// Code denies are included here.
	return snap.AllowsCapability(m.ID, always)
}

// sessionMetaFor / roleIDOf / maxBookingsOf / corpusScopeOf —— see capreg_mcp_app_session.go
// (split out to keep this file under max-lines ≤350).
