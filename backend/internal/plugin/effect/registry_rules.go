// registry_rules.go —— §4.2.2's six lifecycle rules, as a function from a state to the one
// step it admits. Contract: calculus.go.
//
// The rules are reactive only: no rule mentions a scheduler, and `Step` picks whichever fiber it
// finds first. "A theorem proved over all such sequences holds for every scheduling policy a
// runtime might adopt", so the choice here is arbitrary by design — and `StepAt` exists so a test
// can make a different one.

package effect

import "errors"

// StepAt —— apply a lifecycle rule to one fiber, or report that none applies to it.
//
// "None applies" is not the same as "quiet": a fiber the guard is holding has no rule available
// while the registry is still not quiet, and that gap is the whole content of every guard test.
func (r *Registry) StepAt(n Name) (Rule, bool) {
	r.mu.Lock()
	f := r.fibers[n]
	if f == nil {
		r.mu.Unlock()
		return "", false
	}
	rule, act := r.pick(n, f)
	if act == nil {
		r.mu.Unlock()
		return "", false
	}
	r.mu.Unlock()

	act()
	return rule, true
}

// Step —— apply one lifecycle rule wherever one applies.
func (r *Registry) Step() (Applied, bool) {
	r.mu.Lock()
	for _, n := range r.order {
		f := r.fibers[n]
		if f == nil {
			continue
		}
		rule, act := r.pick(n, f)
		if act == nil {
			continue
		}
		r.mu.Unlock()
		act()
		return Applied{Rule: rule, Fiber: n}, true
	}
	r.mu.Unlock()
	return Applied{}, false
}

// pick —— which rule applies to this fiber, and the action that takes it.
//
// Read straight off Table 1. The action runs OUTSIDE the registry lock, because an effect function
// may instantiate (Definition 52) and so re-enter the registry.
func (r *Registry) pick(n Name, f *fiber) (Rule, func()) {
	switch f.phase {
	case PhaseInactive:
		return r.pickInactive(n, f)
	case PhaseReloading, PhaseActive:
		return r.pickOnTarget(n, f)
	case PhaseUnloading:
		// L-Unload's premise is the guard: a provider's withdrawal is held back until every
		// consumer that resolved a key to it has gone.
		if r.reliedLocked(n) {
			return "", nil
		}
		return LUnload, func() { r.unload(n) }
	}
	return "", nil
}

// pickInactive —— L-Begin: θ = Inactive ∧ ω = target_n(γ) ≠ ⊥. A failed fiber is
// excluded, so the same raise is not started again; see `fiber.failed`.
func (r *Registry) pickInactive(n Name, f *fiber) (Rule, func()) {
	target, live := r.targetLocked(n)
	if !live || f.failed {
		return "", nil
	}
	return LBegin, func() { r.begin(n, target) }
}

// pickOnTarget —— the two phases that compare ω against the target view.
//
// L-Iter and L-Finish carry `target_n(γ) = ω`; L-Divert and L-Leave carry its negation. The two
// directions of change are not distinguished: a target that has become ⊥ and one that has become
// some other fiber are equally unequal to ω.
func (r *Registry) pickOnTarget(n Name, f *fiber) (Rule, func()) {
	target, live := r.targetLocked(n)
	onTarget := live && sameView(target, f.committed)

	if f.phase == PhaseReloading {
		if onTarget {
			return r.iterate(n, f)
		}
		return LDivert, func() { r.divert(n) }
	}
	// Active. L-Leave records the decision without acting on it, which is what stops the fiber
	// providing while leaving every committed view intact.
	if onTarget {
		return "", nil
	}
	return LLeave, func() { r.leave(n) }
}

// begin —— L-Begin. Enters Reloading with the fresh iterator, the identity accumulator, and ω
// fixed for the whole episode (Lemma 59(2)).
func (r *Registry) begin(n Name, target View) {
	r.mu.Lock()
	f := r.fibers[n]
	if f == nil || f.phase != PhaseInactive {
		r.mu.Unlock()
		return
	}
	f.phase = PhaseReloading
	f.committed = target
	f.scope = &Scope{}
	deps := r.depsLocked(f, target)
	comp := f.comp
	r.mu.Unlock()

	var it *Iterator
	if comp.Effects != nil {
		it = comp.Effects(deps)
	}
	r.mu.Lock()
	if f.phase == PhaseReloading {
		f.iter = it
	}
	r.mu.Unlock()
}

// iterate —— L-Iter or L-Finish, whichever the iterator's `Maybe` selects.
func (r *Registry) iterate(n Name, f *fiber) (Rule, func()) {
	if f.iter == nil {
		// A component contributing no effects finishes immediately: equation (19)'s degenerate case
		// read at the level of a whole activation.
		return LFinish, func() { r.finish(n, nil) }
	}
	return LIter, func() {
		more, err := f.scope.Advance(f.iter)
		if err != nil {
			// A failed activation withdraws what it installed and leaves; the fiber is not Active,
			// so nothing ever resolved against a half-built provision. It is also marked failed, so
			// the next L-Begin does not start the same raise again — see `fiber.failed`.
			r.mu.Lock()
			f.phase, f.failed = PhaseUnloading, true
			r.mu.Unlock()
			return
		}
		if !more {
			r.finish(n, nil)
		}
	}
}

// finish —— L-Finish: the last iteration lands and the fiber becomes Active, at which point its
// table joins σ_γ and its dependents' target views can name it.
func (r *Registry) finish(n Name, _ error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if f := r.fibers[n]; f != nil && f.phase == PhaseReloading {
		f.phase = PhaseActive
		f.iter = nil
	}
}

// divert —— L-Divert: a transition whose resolution moved under it goes to Unloading carrying
// the inverses accumulated so far, and applies none of them here.
//
// Routing through Active instead "would let the fiber provide its coeffects for the length of one
// step and oblige its dependents to activate against a component that is already leaving".
func (r *Registry) divert(n Name) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if f := r.fibers[n]; f != nil && f.phase == PhaseReloading {
		f.phase = PhaseUnloading
		f.iter = nil
	}
}

// leave —— L-Leave: the decision, not the act. Its Ψ is the identity; nothing moves but θ.
func (r *Registry) leave(n Name) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if f := r.fibers[n]; f != nil && f.phase == PhaseActive {
		f.phase = PhaseUnloading
	}
}

// unload —— L-Unload: the only rule in the calculus that applies an accumulator.
//
// It discards the committed view as its last act, which is the other half of §4.2.2's requirement
// — the consumer reads its coeffects through ω for the whole of its own deactivation. Cordis
// does the same and says so: `delete this.ctx.fiber.store![name]` carries the comment "ensure self
// access before dependencies cleanup".
func (r *Registry) unload(n Name) {
	r.mu.Lock()
	f := r.fibers[n]
	if f == nil || f.phase != PhaseUnloading {
		r.mu.Unlock()
		return
	}
	scope := f.scope
	r.mu.Unlock()

	// The accumulator's own failures are the component's to report, not the calculus's: L-Unload
	// applies φ and the fiber leaves either way, which is what stops one stuck inverse from making
	// a fiber unremovable forever.
	unloadErr := scope.Unload()
	_ = unloadErr

	r.mu.Lock()
	f.phase = PhaseInactive
	f.committed = nil
	f.scope = &Scope{}
	f.iter = nil
	r.mu.Unlock()
}

// Settle —— drive lifecycle rules until quiescence.
//
// Theorem 73 is the claim that this terminates. `ErrNoProgress` is what it returns if it did not:
// unreachable under an acyclic ≺, and reported rather than looped on because silence would be the
// worst outcome if the assumption were ever violated.
func (r *Registry) Settle() error {
	for range settleBudget {
		if r.Quiet() {
			return nil
		}
		if _, ok := r.Step(); !ok {
			return ErrNoProgress
		}
	}
	if r.Quiet() {
		return nil
	}
	return errors.Join(ErrNoProgress, errSettleBudget)
}

// settleBudget —— far above any bound Theorem 73(2) allows for the registries this package is
// used on, so exhausting it means a livelock rather than a slow settle.
const settleBudget = 100_000

var errSettleBudget = errors.New("effect: settle exceeded its step budget")
