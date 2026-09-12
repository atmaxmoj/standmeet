// registry_visitor_state.go —— the block → FiberState projection.
//
// This is exactly the list the frontend's zustand store consumes: which
// blocks exist, which are greyed out, how much quota is left. What sets it
// apart from AssembleVisitor is that it **needs no session** — a block that
// can report its own state (StateReporter) doesn't have to spin up a sandbox
// just to close it right back down for this list (see registry_tool_dispatch.go).

package registry

import (
	"context"
	"errors"
)

// VisitorStates —— the FiberState list for this session (used by the
// pi-pivot frontend zustand store). An enabled=false block still appears —
// so the frontend can render a "disabled because ..." hint.
func (r *Registry) VisitorStates(
	ctx context.Context, in *AssembleInput,
) []FiberState {
	fibers := r.enabledFibers(ctx, in)
	out := make([]FiberState, 0, len(fibers))
	for _, c := range fibers {
		if state, ok := visitorStateFor(ctx, c, in); ok {
			out = append(out, state)
		}
	}
	return out
}

// visitorStateFor —— returns (state, true) meaning this block should
// appear in the frontend's block map; returns (_, false) meaning it's not
// exposed at all (ErrHidden or a nil binding). Any other error means exposed but
// enabled=false (so the frontend can render a degraded hint).
//
// A block that can report its own state (StateReporter) is never dialed —
// spinning up a sandbox just to get {id,enabled,quota} and close it again was
// half of the visitor's 19 seconds (see registry_tool_dispatch.go).
func visitorStateFor(
	ctx context.Context, c Fiber, in *AssembleInput,
) (FiberState, bool) {
	if reporter, ok := c.(StateReporter); ok {
		return reportedState(ctx, reporter, c, in)
	}
	return dialedStateFor(ctx, c, in)
}

// dialedStateFor —— a block that can't report its own state has to be
// instantiated once so its binding can be read.
func dialedStateFor(
	ctx context.Context, c Fiber, in *AssembleInput,
) (FiberState, bool) {
	b, err := c.VisitorBinding(ctx, in)
	if errors.Is(err, ErrHidden) || b == nil && err == nil {
		return FiberState{}, false
	}
	if err != nil {
		state := FiberState{ID: c.ID(), Enabled: false}
		setBlockTitle(&state, c)
		return state, true
	}
	state := finalizeBindingState(b, c.ID())
	setBlockTitle(&state, c)
	return state, true
}

// setBlockTitle —— if the block implements Titled, pass its title through
// into the state (disabled ones carry it too, so the dock button still has a label).
func setBlockTitle(state *FiberState, c Fiber) {
	if t, ok := c.(Titled); ok {
		state.Title = t.Title()
	}
}

// finalizeBindingState —— reads state from an already-built binding and closes
// it right away (this path only wants the state; leaving the session open would
// be a leak).
func finalizeBindingState(b *Binding, blockID string) FiberState {
	state := b.State
	if state.ID == "" {
		state.ID = blockID
	}
	if b.Close != nil {
		b.Close()
	}
	return state
}
