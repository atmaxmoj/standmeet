// registry_visitor_bundle.go —— a single-pass visitor assembly for /sessions.
//
// /sessions needs States + ToolSpecs + PromptPartIDs all at once. Calling
// VisitorStates + VisitorToolSpecs separately used to **cold-dial each
// externalized plugin twice** (each its own VisitorBinding round trip). With two
// real network-sandboxed plugins that's 4 cold dials, pushing one /sessions call
// to ~16s (past the e2e 15s wait). Here each fiber gets exactly one VisitorBinding
// call, and state and tool spec share that one dial. Semantics match calling the
// three methods separately exactly (order, hidden/disabled tests, and the
// prompt-part/binding decoupling are all unchanged).

package registry

import (
	"context"
	"errors"
	"sync"
)

// VisitorBundle —— the three projections one walk produces.
type VisitorBundle struct {
	States        []FiberState
	ToolSpecs     []VisitorToolSpec
	PromptPartIDs []string
}

// AssembleVisitorBundle —— each fiber gets exactly one VisitorBinding call; one
// walk produces States + ToolSpecs + PromptPartIDs. /sessions uses this instead
// of calling the three methods separately (which cold-dialed each externalized
// plugin twice).
//
// **Each fiber is instantiated concurrently.** There's no avoiding "dial all of
// them" (the session needs every tool spec), but there's no reason to dial them
// one at a time: each externalized block instantiation spawns a bwrap
// sandbox (~1s cold start), so serial dialing is N seconds just to start.
// Measured under load, `/api/v1/sessions` took 13.9 seconds while the visitor
// side gives up at 15 — showing up as "the session occasionally fails to open".
// (#17 addressed the **single tool call** path — dial only the one that serves
// that tool. This path needs all of them, so the only thing left to save is how
// the wait is spent.)
//
// **Order is still registration order**: each fiber folds into its own slot first,
// then the slots are concatenated in order. The frontend's block list and
// the prompt part splice order both depend on this — it's the thing concurrency
// most easily loses, hence its own dedicated test.
//
// No ceiling on concurrency: the number of blocks is a small, fixed handful
// set at registration time, not something that grows with request volume.
func (r *Registry) AssembleVisitorBundle(
	ctx context.Context, in *AssembleInput,
) VisitorBundle {
	fibers := r.enabledFibers(ctx, in)
	slots := make([]VisitorBundle, len(fibers))
	var wg sync.WaitGroup
	for i, c := range fibers {
		wg.Go(func() { slots[i] = fiberBundleSlot(ctx, c, in) })
	}
	wg.Wait()
	return mergeVisitorSlots(slots, len(fibers))
}

// fiberBundleSlot —— one fiber's own slot (holds only what it itself contributes).
// Writing concurrently into separate slots avoids touching a shared slice —
// shared appends would both need a lock and turn order into "whoever returns
// first".
func fiberBundleSlot(ctx context.Context, c Fiber, in *AssembleInput) VisitorBundle {
	slot := VisitorBundle{
		States:        make([]FiberState, 0, 1),
		ToolSpecs:     make([]VisitorToolSpec, 0),
		PromptPartIDs: make([]string, 0, 1),
	}
	accumVisitorFiber(ctx, c, in, &slot)
	return slot
}

// mergeVisitorSlots —— concatenates slots back into one bundle in registration
// order. The header is always the first prompt part.
func mergeVisitorSlots(slots []VisitorBundle, n int) VisitorBundle {
	b := VisitorBundle{
		States:        make([]FiberState, 0, n),
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

// accumVisitorFiber —— folds one fiber into the bundle: the prompt-part-id is
// decoupled from the binding (same source as VisitorPromptPartIDs, no dialing);
// the binding is dialed once — active contributes both state and tool specs,
// disabled contributes only an enabled=false state, hidden contributes nothing.
func accumVisitorFiber(
	ctx context.Context, c Fiber, in *AssembleInput, b *VisitorBundle,
) {
	appendPromptPart(ctx, c, in, b)
	binding, err := c.VisitorBinding(ctx, in)
	if isHiddenBinding(binding, err) {
		return
	}
	if err != nil {
		st := FiberState{ID: c.ID(), Enabled: false}
		// Even disabled ones carry a title: a greyed-out dock button needs a
		// label.
		setBlockTitle(&st, c)
		b.States = append(b.States, st)
		return
	}
	accumActiveBinding(ctx, binding, c, b)
}

// appendPromptPart —— the fiber's system-prompt fragment id (added only if
// non-empty), unrelated to the binding (same source as VisitorPromptPartIDs, no
// dialing).
func appendPromptPart(
	ctx context.Context, c Fiber, in *AssembleInput, b *VisitorBundle,
) {
	if id := c.SystemPromptFragmentID(ctx, in); id != "" {
		b.PromptPartIDs = append(b.PromptPartIDs, id)
	}
}

// isHiddenBinding —— ErrHidden, or a clean nil binding, means this block is not
// exposed at all (matches visitorStateFor's hidden test).
func isHiddenBinding(b *Binding, err error) bool {
	return errors.Is(err, ErrHidden) || (b == nil && err == nil)
}

// accumActiveBinding —— an active binding folds into both state and tool specs,
// then Close at the end.
func accumActiveBinding(
	ctx context.Context, binding *Binding, c Fiber, b *VisitorBundle,
) {
	state := binding.State
	if state.ID == "" {
		state.ID = c.ID()
	}
	setBlockTitle(&state, c) // dock button label passes through the MCP title (no id fallback)
	b.States = append(b.States, state)
	for i := range binding.Tools {
		b.ToolSpecs = append(b.ToolSpecs, toolToVisitorSpec(ctx, &binding.Tools[i]))
	}
	if binding.Close != nil {
		binding.Close()
	}
}
