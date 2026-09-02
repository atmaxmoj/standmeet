// registry_visitor_state.go —— the capability → CapabilityState projection.
//
// This is exactly the list the frontend's zustand store consumes: which
// capabilities exist, which are greyed out, how much quota is left. What sets it
// apart from AssembleVisitor is that it **needs no session** — a capability that
// can report its own state (StateReporter) doesn't have to spin up a sandbox
// just to close it right back down for this list (see registry_tool_dispatch.go).

package capreg

import (
	"context"
	"errors"
)

// VisitorStates —— the CapabilityState list for this session (used by the
// pi-pivot frontend zustand store). An enabled=false capability still appears —
// so the frontend can render a "disabled because ..." hint.
func (r *Registry) VisitorStates(
	ctx context.Context, in *AssembleInput,
) []CapabilityState {
	caps := r.enabledCaps(ctx, in)
	out := make([]CapabilityState, 0, len(caps))
	for _, c := range caps {
		if state, ok := visitorStateFor(ctx, c, in); ok {
			out = append(out, state)
		}
	}
	return out
}

// visitorStateFor —— returns (state, true) meaning this capability should
// appear in the frontend's capability map; returns (_, false) meaning it's not
// exposed at all (ErrHidden or a nil binding). Any other error means exposed but
// enabled=false (so the frontend can render a degraded hint).
//
// A capability that can report its own state (StateReporter) is never dialed —
// spinning up a sandbox just to get {id,enabled,quota} and close it again was
// half of the visitor's 19 seconds (see registry_tool_dispatch.go).
func visitorStateFor(
	ctx context.Context, c Capability, in *AssembleInput,
) (CapabilityState, bool) {
	if reporter, ok := c.(StateReporter); ok {
		return reportedState(ctx, reporter, c, in)
	}
	return dialedStateFor(ctx, c, in)
}

// dialedStateFor —— a capability that can't report its own state has to be
// instantiated once so its binding can be read.
func dialedStateFor(
	ctx context.Context, c Capability, in *AssembleInput,
) (CapabilityState, bool) {
	b, err := c.VisitorBinding(ctx, in)
	if errors.Is(err, ErrHidden) || b == nil && err == nil {
		return CapabilityState{}, false
	}
	if err != nil {
		state := CapabilityState{ID: c.ID(), Enabled: false}
		setCapTitle(&state, c)
		return state, true
	}
	state := finalizeBindingState(b, c.ID())
	setCapTitle(&state, c)
	return state, true
}

// setCapTitle —— if the capability implements Titled, pass its title through
// into the state (disabled ones carry it too, so the dock button still has a label).
func setCapTitle(state *CapabilityState, c Capability) {
	if t, ok := c.(Titled); ok {
		state.Title = t.Title()
	}
}

// finalizeBindingState —— reads state from an already-built binding and closes
// it right away (this path only wants the state; leaving the session open would
// be a leak).
func finalizeBindingState(b *Binding, capID string) CapabilityState {
	state := b.State
	if state.ID == "" {
		state.ID = capID
	}
	if b.Close != nil {
		b.Close()
	}
	return state
}
