// mounted_warm.go —— mcpAppFiber's listing path + the spec/UI warm that backs it. Split out of
// mounted.go to stay under the max-lines ceiling.
//
// The listing path (VisitorListBinding) is dial-free: it serves an assembly's tool specs + ui://
// card HTML from a shared cache that a one-time warm fills. The warm runs synchronously at boot
// (WarmVisitorBlock, driven by registry.WarmVisitorBlocks) so the first session is already hot,
// and as a background self-heal (warmInBackground) for a block first reached cold.

package mount

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// VisitorListBinding —— the LISTING path (AssembleVisitorBundle), split off from VisitorBinding.
//
// VisitorBinding stays the CALL path: dialIfMayServe (AssembleVisitorForTool) still uses it and
// needs a live session to execute a tool, so it must keep dialing. But listing only ever reads
// .State/.ToolSpecs — the Tools returned here are NEVER called through this binding (calls go via
// AssembleVisitorForTool → a fresh dial). So listing needs no session: with specs + UI cards
// cached, it builds the whole binding from cache with NO dial (Close is a no-op), which keeps a
// per-poll app-state assembly off the ~2s node cold-start that was timing binds out. When the
// cache is cold it kicks a one-shot BACKGROUND warm and returns State (dock button) with no tools
// yet; the tools appear on the next poll — overlapping the visitor still typing their question.
func (c *mcpAppFiber) VisitorListBinding(
	ctx context.Context, in *registry.AssembleInput,
) (*registry.Binding, error) {
	expose, gerr := c.exposable(ctx, in)
	if gerr != nil {
		return nil, gerr
	}
	if !expose {
		return nil, registry.ErrHidden
	}
	if c.cachesWarm() {
		specs, _ := c.knownToolSpecs()
		ui, _ := c.knownUI()
		return c.cachedListBinding(ctx, in, specs, ui), nil
	}
	// Cold. The startup warm (WarmVisitorBlocks, blocking at boot) primes every block's cache
	// before the server serves, so in practice this branch is only reached when a block was
	// registered AFTER boot (an owner installs one) or its boot warm timed out. Return State (dock
	// button) and kick a background warm; a later assembly binds hot. Deliberately does NOT block
	// here — a per-session wait stacks across cold blocks and slows/times out every assembly.
	c.warmInBackground(in) //nolint:contextcheck // detached warm outlives the request
	return &registry.Binding{
		Tools:     nil, // warm not landed: State (dock button) shows; a later assembly binds hot
		State:     c.stateFor(ctx, in),
		Close:     func() {},
		ClaimGate: claimGateOf(&c.m),
	}, nil
}

// cachesWarm —— true once BOTH the spec and UI caches are warm. Both must be ready together: specs
// without ui would drop every card. The values are fetched separately by the caller when true.
func (c *mcpAppFiber) cachesWarm() bool {
	_, sok := c.knownToolSpecs()
	_, uok := c.knownUI()
	return sok && uok
}

// cachedListBinding —— the dial-free listing binding built from the warm cache (Close is a no-op;
// its Tools are never CALLED here — calls go via AssembleVisitorForTool's own dial).
func (c *mcpAppFiber) cachedListBinding(
	ctx context.Context, in *registry.AssembleInput, specs []mcpclient.Tool, ui map[string]string,
) *registry.Binding {
	return &registry.Binding{
		Tools:     wrapMCPAppToolsCached(&c.m, specs, ui, sessionMetaFor(&c.m, in)),
		State:     c.stateFor(ctx, in),
		Close:     func() {},
		ClaimGate: claimGateOf(&c.m),
	}
}

// knownUI —— returns (cache, true) once the warm dial has cached the UI card HTML. Keyed on its OWN
// atomic flag, not on len(tools): a tool CALL fills `tools` without ever filling `ui`, so inferring
// UI-readiness from tools would hand listing an empty ui map and drop every card for the session.
func (c *mcpAppFiber) knownUI() (map[string]string, bool) {
	if atomic.LoadInt32(c.uiReady) == 0 {
		return map[string]string{}, false
	}
	return *c.ui, true
}

// WarmVisitorBlock —— the one-time startup warm (registry.VisitorBlockWarmer), dialed
// SYNCHRONOUSLY: dial this block once and cache its specs + ui:// card HTML, so the shared cache is
// HOT before the server serves. The fiber is a process-lifetime singleton, so this one dial serves
// every later session — assembly then returns full tool_specs (incl. the card HTML) with no dial,
// and no session pays the ~2s node cold-start on its hot path. Called concurrently across blocks
// by registry.WarmVisitorBlocks (which bounds the total boot wait); each call blocks its goroutine.
func (c *mcpAppFiber) WarmVisitorBlock(ctx context.Context) {
	c.warmOnce(ctx, &registry.AssembleInput{ConversationID: warmConversationID})
}

// warmConversationID —— the fixed conversation id a warm dials under (its throwaway sandbox
// workspace). Distinct so it never collides with a real conversation's workspace.
const warmConversationID = "__block_warm__"

// warmDialTimeout —— budget for the warm dial. Same order as the live dial's 20s.
const warmDialTimeout = 20 * time.Second

// warmInBackground —— warmOnce on a detached goroutine, for the SELF-HEAL case only (a block first
// reached cold — registered after boot, or its boot warm timed out). A finished/cancelled request
// must not kill it, hence context.Background.
func (c *mcpAppFiber) warmInBackground(_ *registry.AssembleInput) {
	go c.warmOnce(context.Background(), &registry.AssembleInput{ConversationID: warmConversationID})
}

// skipWarm —— this fiber should not be warmed at all: a workspace-per-session block
// (sandbox.workspace=true, e.g. a filesystem server rooted at /workspace) would provision a stray
// per-session workspace under the synthetic warm conversation id (polluting the workspace listing +
// leaking a dir the TTL cron must sweep), and such blocks are per-session stateful anyway; or the
// cache is already warm. One choke point for both the startup warm and the cold self-heal.
func (c *mcpAppFiber) skipWarm() bool {
	if s := c.m.Transport.Sandbox; s != nil && s.Workspace {
		return true
	}
	return c.cachesWarm()
}

// warmOnce —— dial once and fill the spec + UI caches, then close. Atomic single-flight (the
// `warming` guard): one warm at a time whether kicked from boot or a cold self-heal; a duplicate
// caller returns immediately. On failure it resets to idle so a later attempt retries. Bounded by
// its own dial timeout.
func (c *mcpAppFiber) warmOnce(ctx context.Context, in *registry.AssembleInput) {
	if c.skipWarm() {
		return
	}
	if !atomic.CompareAndSwapInt32(c.warming, 0, 1) {
		return // a warm is already in flight
	}
	defer atomic.StoreInt32(c.warming, 0)
	dctx, cancel := context.WithTimeout(ctx, warmDialTimeout)
	defer cancel()
	ds, err := c.dialWithCachedSpecs(dctx, in) // fills the spec cache (toolsOnce) as a side effect
	if err != nil {
		return
	}
	c.cacheUI(dctx, ds.sess, ds.tools)
	closeAndRevoke(ds.sess, ds.nativeKey)()
}

// cacheUI —— read each tool's ui:// card once and cache the HTML (paired with the spec cache), so
// the listing path can hand back UIHTML with no live session.
// Only ever called from the single in-flight warm goroutine (the `warming` guard serialises it), so
// no CAS is needed for exclusion — but the ui map MUST be published before uiReady flips to 1, or a
// concurrent knownUI reader could see the flag set and the map still empty. Fill first, store last;
// the atomic store/load pair carries the happens-before so a reader that sees 1 sees the full map.
func (c *mcpAppFiber) cacheUI(
	ctx context.Context, sess *mcpclient.Session, tools []mcpclient.Tool,
) {
	if atomic.LoadInt32(c.uiReady) == 1 {
		return // already cached
	}
	m := map[string]string{}
	for i := range tools {
		cacheOneToolUI(ctx, sess, &tools[i], m)
	}
	*c.ui = m
	atomic.StoreInt32(c.uiReady, 1)
}

// cacheOneToolUI —— read one tool's ui:// card into m (deduped by uri), if it declares one and the
// read succeeds. A read failure degrades to no card, never blocking the warm.
func cacheOneToolUI(
	ctx context.Context, sess *mcpclient.Session, t *mcpclient.Tool, m map[string]string,
) {
	uri, ok := t.Meta["ui_resource"].(string)
	if !ok || uri == "" {
		return
	}
	if _, seen := m[uri]; seen {
		return
	}
	if html, rerr := sess.ReadResource(ctx, uri); rerr == nil {
		m[uri] = html
	}
}

// cachedToolSpecs —— cache the tool specs (including _meta) from the first dial and always return
// the cache after: once cached, a cold-start high-load ListTools can no longer drop
// return_directly/progress_label. Execution still uses this dial's live session; only the specs
// come from the cache.
func (c *mcpAppFiber) cachedToolSpecs(dialed []mcpclient.Tool) []mcpclient.Tool {
	c.toolsOnce.Do(func() {
		*c.tools = dialed
		reportToolDrift(&c.m, dialed)
	})
	return *c.tools
}

// knownToolSpecs —— returns (specs, true) if cached. Read-only, does not trigger Once — that would
// let the first call cache an empty slice as "known", leaving no tools forever after.
func (c *mcpAppFiber) knownToolSpecs() ([]mcpclient.Tool, bool) {
	if len(*c.tools) == 0 {
		return []mcpclient.Tool{}, false
	}
	return *c.tools, true
}
