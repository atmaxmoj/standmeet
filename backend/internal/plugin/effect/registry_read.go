// registry_read.go —— reading F_γ: σ_γ, the target view, the guard, quiescence. Contract:
// fiber.go.
//
// Everything here is DERIVED on the read. Equation (46) makes σ_γ the union over the Active
// fibers' own tables, and Cordis computes the same thing the same way — `ReflectService.store`
// holds one entry per live provision, and a fiber's withdrawal `delete`s from it rather than
// editing a second record. A stored seam→supplier table is the same information in the
// arrangement where it can disagree with reality, which is the arrangement §4.2.2's guard cannot
// be built on.

package effect

// Coeffects —— σ_γ := ⋃{σ_m | m ∈ dom(F_γ), θ_m = Active}.
//
// Over Active fibers ALONE. A Reloading or Unloading fiber contributes nothing however much its own
// table holds, and that gap is load-bearing: it is what takes a departing provider out of every
// target view before it has withdrawn a single binding, which is why the guard releases instead of
// deadlocking (Theorem 73).
func (r *Registry) Coeffects() *Table {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.coeffectsLocked()
}

func (r *Registry) coeffectsLocked() *Table {
	union := &Table{}
	for _, n := range r.order {
		if f := r.fibers[n]; f != nil && f.phase == PhaseActive {
			copyBindings(f.table, union)
		}
	}
	return union
}

// copyBindings —— add one fiber's own bindings to the union.
//
// A failed Set here would mean two Active fibers claim one key, which Definition 63 clause (2)
// rules out and O-Insert's fourth premise prevents. Skipping rather than panicking keeps a
// read-only operation read-only; `WellFormed` is where that invariant is asserted.
func copyBindings(from, into *Table) {
	for _, k := range from.Keys() {
		v, err := from.Get(k)
		if err != nil {
			continue
		}
		_, setErr := into.Set(k, v)
		_ = setErr // disjointness makes a collision unreachable; WellFormed asserts the invariant
	}
}

// Provider —— provider_k(γ): the one Active fiber whose table holds k.
//
// One, because O-Insert refuses a second component declaring the key: "each k ∈ dom(σ_γ) lies
// in the table of exactly one Active fiber".
func (r *Registry) Provider(k string) Name {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.providerLocked(k)
}

func (r *Registry) providerLocked(k string) Name {
	for _, n := range r.order {
		f := r.fibers[n]
		if f == nil || f.phase != PhaseActive {
			continue
		}
		if _, err := f.table.Get(k); err == nil {
			return n
		}
	}
	return ""
}

// Target —— Definition 53. `ok == false` is ⊥: n ought not to be running at all.
//
// It answers to two things and nothing else — retirement through τ_n, and coeffect resolution
// through provider_k. No health check, no manual switch, no scheduler.
func (r *Registry) Target(n Name) (View, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.targetLocked(n)
}

func (r *Registry) targetLocked(n Name) (View, bool) {
	f := r.fibers[n]
	if f == nil || f.retired {
		return nil, false
	}
	view := View{}
	for _, k := range f.comp.Requires {
		p := r.providerLocked(k)
		if p == "" {
			return nil, false // γ ⊭ d_n
		}
		view[k] = p
	}
	return view, true
}

// sameView —— ω equality. The comparison is on PROVIDERS, which is the whole reason Definition
// 53 records a name rather than a value: a different fiber providing an equal value must compare
// unequal, or a swap goes unnoticed.
func sameView(a, b View) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// Relied —— Definition 54, the guard. Per BINDING, not per fiber: a fiber that declares none of
// n's keys is no obstacle.
func (r *Registry) Relied(n Name) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.reliedLocked(n)
}

func (r *Registry) reliedLocked(n Name) bool {
	for m, f := range r.fibers {
		if m != n && dependsOn(f, n) {
			return true
		}
	}
	return false
}

// dependsOn —— is this fiber installed AND resolving one of its declared keys to n?
//
// Both halves matter. An uninstalled fiber holds no committed view to name anybody, and an
// installed one that declares none of n's keys is no obstacle — the guard is per BINDING, not per
// fiber.
func dependsOn(f *fiber, n Name) bool {
	return f != nil && f.installed() && resolvesTo(f, n)
}

// resolvesTo —— does this fiber's committed view name n at any key it declared?
//
// Per BINDING, which is what makes the guard precise: a fiber that declares none of n's keys is no
// obstacle to n leaving, and neither is one that resolved n's key in another realm.
func resolvesTo(f *fiber, n Name) bool {
	for _, k := range f.comp.Requires {
		if f.committed[k] == n {
			return true
		}
	}
	return false
}

// Quiet —— Definition 53's quiet(γ). The third clause is why a fiber mid-transition is never
// quiet, whatever its target says.
func (r *Registry) Quiet() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, n := range r.order {
		if f := r.fibers[n]; f != nil && !r.settledLocked(n, f) {
			return false
		}
	}
	return true
}

// Installed —— equation (44): installed_n(γ) := θ_n ≠ Inactive. A fiber carrying an
// accumulator and a committed view, whichever direction it is moving in.
func (f *Fiber) Installed() bool { return f.Phase != PhaseInactive }

// Failed —— whether this fiber's activation raised and has not been re-declared since.
//
// Distinct from Waiting, which is a fiber working exactly as designed. Reporting the two the same
// way is how a correct system gets reported as broken, and how a broken one gets reported as
// patient.
func (r *Registry) Failed(n Name) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	f := r.fibers[n]
	return f != nil && f.failed
}

// settledLocked —— has this fiber reached its target view, in Definition 53's sense?
//
// A FAILED fiber counts as settled. The paper's quiet has no such clause because Definition 48's
// effect function is total; Cordis's `_getState` does — `if (this._error) return
// FiberState.FAILED` — and without it a broken component leaves the registry permanently
// not-quiet with no rule able to move it, which presents as a livelock rather than as a failure.
func (r *Registry) settledLocked(n Name, f *fiber) bool {
	if inTransition[f.phase] {
		return false // a transition in progress is never quiet, whatever its target says
	}
	target, live := r.targetLocked(n)
	if f.phase == PhaseActive {
		return live && sameView(target, f.committed)
	}
	// Inactive: settled when it OUGHT not to be running — or when it failed trying. A FAILED
	// fiber counts as settled; the paper's quiet has no such clause because Definition 48's effect
	// function is total, but Cordis's `_getState` does (`if (this._error) return FAILED`), and
	// without it a broken component leaves the registry permanently not-quiet with no rule able to
	// move it, which presents as a livelock rather than as a failure.
	return !live || f.failed
}

// inTransition —— the two phases of Definition 49 that a transition OCCUPIES, as against the
// two it rests at. Quiescence is defined against the settled pair, so naming the other two is the
// whole content of `quiet`'s third clause.
var inTransition = map[Phase]bool{PhaseReloading: true, PhaseUnloading: true}

// Get —— the fiber under this name.
func (r *Registry) Get(n Name) (Fiber, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f := r.fibers[n]
	if f == nil {
		return Fiber{}, false
	}
	return Fiber{
		Component: f.comp,
		Parent:    f.parent,
		Retired:   f.retired,
		Phase:     f.phase,
		Committed: f.committed,
	}, true
}

// Names —— dom(F_γ) in insertion order. Order carries no meaning; no rule of the calculus
// reads it.
func (r *Registry) Names() []Name {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Name(nil), r.order...)
}

// TableOf —— σ_n, one fiber's own table, whatever its phase.
//
// Definition 51 is why this is separate from Coeffects: "a binding a transition has written stays
// in the fiber's table before the fiber is Active, and that binding is what the inverse is held to
// remove". A test of recovery looks here; a test of resolution looks at σ_γ.
func (r *Registry) TableOf(n Name) *Table {
	r.mu.Lock()
	defer r.mu.Unlock()
	if f := r.fibers[n]; f != nil {
		return f.table
	}
	return &Table{}
}

// Snapshot —— the control half of a quiesced state.
func (r *Registry) Snapshot() map[Name]Phase {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[Name]Phase, len(r.fibers))
	for n, f := range r.fibers {
		out[n] = f.phase
	}
	return out
}
