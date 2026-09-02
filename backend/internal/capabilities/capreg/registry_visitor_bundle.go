// registry_visitor_bundle.go —— a single-pass visitor assembly for /sessions.
//
// /sessions needs States + ToolSpecs + PromptPartIDs all at once. Calling
// VisitorStates + VisitorToolSpecs separately used to **cold-dial each
// externalized plugin twice** (each its own VisitorBinding round trip). With two
// real network-sandboxed plugins that's 4 cold dials, pushing one /sessions call
// to ~16s (past the e2e 15s wait). Here each cap gets exactly one VisitorBinding
// call, and state and tool spec share that one dial. Semantics match calling the
// three methods separately exactly (order, hidden/disabled tests, and the
// prompt-part/binding decoupling are all unchanged).

package capreg

import (
	"context"
	"errors"
	"sync"
)

// VisitorBundle —— the three projections one walk produces.
type VisitorBundle struct {
	States        []CapabilityState
	ToolSpecs     []VisitorToolSpec
	PromptPartIDs []string
}

// AssembleVisitorBundle —— each cap gets exactly one VisitorBinding call; one
// walk produces States + ToolSpecs + PromptPartIDs. /sessions uses this instead
// of calling the three methods separately (which cold-dialed each externalized
// plugin twice).
//
// **Each cap is instantiated concurrently.** There's no avoiding "dial all of
// them" (the session needs every tool spec), but there's no reason to dial them
// one at a time: each externalized capability instantiation spawns a bwrap
// sandbox (~1s cold start), so serial dialing is N seconds just to start.
// Measured under load, `/api/v1/sessions` took 13.9 seconds while the visitor
// side gives up at 15 — showing up as "the session occasionally fails to open".
// (#17 addressed the **single tool call** path — dial only the one that serves
// that tool. This path needs all of them, so the only thing left to save is how
// the wait is spent.)
//
// **Order is still registration order**: each cap folds into its own slot first,
// then the slots are concatenated in order. The frontend's capability list and
// the prompt part splice order both depend on this — it's the thing concurrency
// most easily loses, hence its own dedicated test.
//
// No cap on concurrency: the number of capabilities is a small, fixed handful
// set at registration time, not something that grows with request volume.
func (r *Registry) AssembleVisitorBundle(
	ctx context.Context, in *AssembleInput,
) VisitorBundle {
	caps := r.enabledCaps(ctx, in)
	slots := make([]VisitorBundle, len(caps))
	var wg sync.WaitGroup
	for i, c := range caps {
		wg.Go(func() { slots[i] = capBundleSlot(ctx, c, in) })
	}
	wg.Wait()
	return mergeVisitorSlots(slots, len(caps))
}

// capBundleSlot —— one cap's own slot (holds only what it itself contributes).
// Writing concurrently into separate slots avoids touching a shared slice —
// shared appends would both need a lock and turn order into "whoever returns
// first".
func capBundleSlot(ctx context.Context, c Capability, in *AssembleInput) VisitorBundle {
	slot := VisitorBundle{
		States:        make([]CapabilityState, 0, 1),
		ToolSpecs:     make([]VisitorToolSpec, 0),
		PromptPartIDs: make([]string, 0, 1),
	}
	accumVisitorCap(ctx, c, in, &slot)
	return slot
}

// mergeVisitorSlots —— concatenates slots back into one bundle in registration
// order. The header is always the first prompt part.
func mergeVisitorSlots(slots []VisitorBundle, n int) VisitorBundle {
	b := VisitorBundle{
		States:        make([]CapabilityState, 0, n),
		ToolSpecs:     make([]VisitorToolSpec, 0),
		PromptPartIDs: make([]string, 0, 1+n),
	}
	b.PromptPartIDs = append(b.PromptPartIDs, VisitorHeaderFragmentID)
	for i := range slots {
		b.States = append(b.States, slots[i].States...)
		b.ToolSpecs = append(b.ToolSpecs, slots[i].ToolSpecs...)
		b.PromptPartIDs = append(b.PromptPartIDs, slots[i].PromptPartIDs...)
	}
	return b
}

// accumVisitorCap —— folds one capability into the bundle: the prompt-part-id is
// decoupled from the binding (same source as VisitorPromptPartIDs, no dialing);
// the binding is dialed once — active contributes both state and tool specs,
// disabled contributes only an enabled=false state, hidden contributes nothing.
func accumVisitorCap(
	ctx context.Context, c Capability, in *AssembleInput, b *VisitorBundle,
) {
	appendPromptPart(ctx, c, in, b)
	binding, err := c.VisitorBinding(ctx, in)
	if isHiddenBinding(binding, err) {
		return
	}
	if err != nil {
		st := CapabilityState{ID: c.ID(), Enabled: false}
		// Even disabled ones carry a title: a greyed-out dock button needs a
		// label.
		setCapTitle(&st, c)
		b.States = append(b.States, st)
		return
	}
	accumActiveBinding(ctx, binding, c, b)
}

// appendPromptPart —— the cap's system-prompt fragment id (added only if
// non-empty), unrelated to the binding (same source as VisitorPromptPartIDs, no
// dialing).
func appendPromptPart(
	ctx context.Context, c Capability, in *AssembleInput, b *VisitorBundle,
) {
	if id := c.SystemPromptFragmentID(ctx, in); id != "" {
		b.PromptPartIDs = append(b.PromptPartIDs, id)
	}
}

// isHiddenBinding —— ErrHidden, or a clean nil binding, means this cap is not
// exposed at all (matches visitorStateFor's hidden test).
func isHiddenBinding(b *Binding, err error) bool {
	return errors.Is(err, ErrHidden) || (b == nil && err == nil)
}

// accumActiveBinding —— an active binding folds into both state and tool specs,
// then Close at the end.
func accumActiveBinding(
	ctx context.Context, binding *Binding, c Capability, b *VisitorBundle,
) {
	state := binding.State
	if state.ID == "" {
		state.ID = c.ID()
	}
	setCapTitle(&state, c) // dock button label passes through the MCP title (no id fallback)
	b.States = append(b.States, state)
	for i := range binding.Tools {
		b.ToolSpecs = append(b.ToolSpecs, toolToVisitorSpec(ctx, &binding.Tools[i]))
	}
	if binding.Close != nil {
		binding.Close()
	}
}
