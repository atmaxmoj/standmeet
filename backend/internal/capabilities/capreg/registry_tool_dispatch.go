// registry_tool_dispatch.go — assembly for the single-tool-call path.
//
// A visitor clicks a card button once → POST /sessions/{id}/tools/{name}.
// This path **only ever needs one tool**, yet AssembleVisitor instantiates
// every capability — instantiating an externalized capability means spinning
// up a bwrap sandbox. Add in that a CapabilityState must be reported back
// after execution too (which VisitorBinding-dials each capability again), and
// one click was measured spawning **2N** sandbox dials, where N is the number
// of installed externalized capabilities. About 1s each when idle, up to 19
// seconds observed end to end when the machine is loaded: the visitor stares
// at a button that hasn't responded, thinks it didn't fire, and clicks again.
//
// This file collects two fixes, each dropping one N:
//
//   - AssembleVisitorForTool — only dials capabilities that **might provide
//     this tool**. Which capability provides which tool is server-level
//     static information — once dialed the first time, a capability knows it
//     itself (ToolNameKnower); one that doesn't know yet is dialed as usual
//     (the cold start), and dialing stops as soon as a match is found.
//   - StateReporter — reporting state doesn't need a session. A capability
//     that implements it doesn't have to spin up a sandbox and tear it back
//     down just to get {id,enabled,quota}.
//
// What must stay invariant is the **gate**: role authorization, an
// unconnected connector, quota exhaustion — these decisions must match the
// dial path exactly (a button greying out the instant quota runs out relies
// on that state coming out of this very run). Only one thing changes: when a
// sandbox fails to start, the capability used to **vanish** from the state
// list (the button silently disappears); now it stays in the list as usual,
// and clicking it gets back a tool-failure receipt.

package capreg

import (
	"context"
	"slices"
)

// ToolNameKnower — a capability that can name which tools it exposes without
// dialing.
//
// The second return value means "knows or doesn't know", not "has or doesn't
// have": a capability that hasn't been dialed yet answers false, and the
// dispatch side dials it as usual. **An empty slice must never mean "don't
// know"** — that would make a capability with genuinely zero tools
// indistinguishable from one that just hasn't been dialed yet. Names must
// **exactly match** those in Binding.Tools (prefixed stays prefixed), or this
// capability gets skipped forever.
type ToolNameKnower interface {
	KnownToolNames() ([]string, bool)
}

// StateReporter — a capability that can report its own CapabilityState
// without dialing. Returning (state, false) means it's not exposed to this
// session at all (like ErrHidden, doesn't enter the map). Its gating
// decisions must use the exact same rules as VisitorBinding, or state will
// stop matching the tools actually exposed.
type StateReporter interface {
	VisitorStateOnly(ctx context.Context, in *AssembleInput) (CapabilityState, bool)
}

// reportedState — the state from the StateReporter path, with title filled in
// (the dock button label comes from Titled, same as the dial path).
func reportedState(
	ctx context.Context, reporter StateReporter, c Capability, in *AssembleInput,
) (CapabilityState, bool) {
	st, exposed := reporter.VisitorStateOnly(ctx, in)
	if !exposed {
		return CapabilityState{}, false
	}
	if st.ID == "" {
		st.ID = c.ID()
	}
	setCapTitle(&st, c)
	return st, true
}

// AssembleVisitorForTool — assembles **only as far as running the tool
// requires**.
//
// The returned bindings may include a few that don't contain this tool
// (capabilities whose tool names aren't cached yet can only be known by
// dialing); the caller still Closes the whole slice as usual. Dialing stops
// once a match is found. If none is found, the ones already dialed are
// returned, and the caller responds with capability_not_enabled based on
// that.
func (r *Registry) AssembleVisitorForTool(
	ctx context.Context, in *AssembleInput, tool string,
) []*Binding {
	caps := r.enabledCaps(ctx, in)
	out := make([]*Binding, 0, 1)
	for _, c := range caps {
		b := dialIfMayServe(ctx, c, in, tool)
		if b == nil {
			continue
		}
		out = append(out, b)
		if bindingHasTool(b, tool) {
			break
		}
	}
	return out
}

// MCPIDForTool — which capability this tool belongs to (= the mcp id used to
// bucket app-state).
//
// A card reading/writing its own app-state slot only needs this one answer.
// The caller used to run a full AssembleVisitor and dig through the bindings
// itself — every time a card moved, the whole row of externalized
// capabilities' sandboxes cold-started again (one read was measured taking 6
// seconds, with the card sitting empty the whole time). Ownership is static
// information: a capability that can name its own tools (ToolNameKnower)
// answers without dialing; one that can't is dialed (the cold start).
//
// Not found → ("", false), and the caller responds with tool_not_enabled
// based on that — matching what happened before when a lookup through
// bindings came up empty.
func (r *Registry) MCPIDForTool(
	ctx context.Context, in *AssembleInput, tool string,
) (string, bool) {
	for _, c := range r.enabledCaps(ctx, in) {
		if id, ok := capOwnsTool(ctx, c, in, tool); ok {
			return id, true
		}
	}
	return "", false
}

// capOwnsTool — whether this capability provides the tool. One that can name
// its own tools answers directly; one that can't gets dialed.
func capOwnsTool(
	ctx context.Context, c Capability, in *AssembleInput, tool string,
) (string, bool) {
	if names, known := knownToolNames(c); known {
		if !slices.Contains(names, tool) {
			return "", false
		}
		return c.ID(), true
	}
	return dialAndCheckTool(ctx, c, in, tool)
}

// knownToolNames — the tool names a capability can name without dialing.
// The second return value is what carries "knows or doesn't know"; the names
// side is always an empty container, never nil — "don't know" is expressed by
// the bool, never by nil (see ToolNameKnower: using an empty slice for "don't
// know" would conflate it with "genuinely zero tools").
func knownToolNames(c Capability) ([]string, bool) {
	knower, ok := c.(ToolNameKnower)
	if !ok {
		return []string{}, false
	}
	return knower.KnownToolNames()
}

// dialAndCheckTool — the first cold start: dial it to see whether it actually
// has this tool. The binding is closed as soon as it's used — this only needs
// a name, not a session.
func dialAndCheckTool(
	ctx context.Context, c Capability, in *AssembleInput, tool string,
) (string, bool) {
	b, err := c.VisitorBinding(ctx, in)
	if err != nil || b == nil {
		return "", false
	}
	defer closeBinding(b)
	if !bindingHasTool(b, tool) {
		return "", false
	}
	return bindingCapID(b, c), true
}

// bindingCapID — the id a binding self-reports takes priority (matches what
// app-state used to read from b.State.ID); falls back to the capability id
// when empty.
func bindingCapID(b *Binding, c Capability) string {
	if b.State.ID != "" {
		return b.State.ID
	}
	return c.ID()
}

func closeBinding(b *Binding) {
	if b.Close != nil {
		b.Close()
	}
}

// dialIfMayServe — instantiates it if it might provide the tool; returns nil
// = skip (either can't possibly provide it, or the dial itself failed).
func dialIfMayServe(
	ctx context.Context, c Capability, in *AssembleInput, tool string,
) *Binding {
	if !mayServeTool(c, tool) {
		return nil
	}
	b, err := c.VisitorBinding(ctx, in)
	if err != nil {
		return nil
	}
	return b
}

// mayServeTool — whether this capability might possibly provide the tool.
// One that can't name its own tools (doesn't implement ToolNameKnower, or
// hasn't been dialed yet) is always treated as "might" — better to dial for
// nothing than to miss it.
func mayServeTool(c Capability, tool string) bool {
	knower, ok := c.(ToolNameKnower)
	if !ok {
		return true
	}
	names, known := knower.KnownToolNames()
	if !known {
		return true
	}
	return slices.Contains(names, tool)
}

func bindingHasTool(b *Binding, tool string) bool {
	for i := range b.Tools {
		if b.Tools[i].Name == tool {
			return true
		}
	}
	return false
}
