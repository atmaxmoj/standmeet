// registry_state.go —— the registry F_γ and §4.2.1's three orchestration rules. Contract:
// fiber.go and calculus.go.
//
// # Checked against cordis, not against memory
//
// `ReflectService.provide` (packages/core/src/reflect.ts) is the same three facts this file
// implements, in the same order:
//
//	if (this.store[key]) throw new Error(`service "${name}" has been registered at ...`)
//
// — the single-source discipline, refused rather than resolved. Here it is O-Insert's fourth
// premise, refused one step EARLIER still: at insert, on the declaration, before either component
// has run. Cordis can only refuse at provide because a plugin's services are not declared up front;
// a manifest's `provides:` is, which is what lets §4.3 predict the quiesced state statically.
//
// And its withdrawal, which is §4.2.2's whole shape in four lines:
//
//	delete this.store[key]                                  // leaves σ_γ: L-Leave
//	const fibers = this.notify([name])                      // dependents' target views turn
//	await Promise.allSettled(fibers.map(f => f.await()))    // the guard: ¬relied_n(γ)
//	delete this.ctx.fiber.store![name]                      // ...and only then its own record
//
// the last line carrying the comment `// ensure self access before dependencies cleanup` — which
// is the paper's "the consumer must therefore still be able to read the key throughout its own
// deactivation".

package effect

import (
	"fmt"
	"slices"
	"sync"
)

// fiber —— one entry of F_γ. Definition 49's tuple, with the accumulator and the remaining
// iterator held as the `Scope` and `Iterator` this package already has.
type fiber struct {
	comp   Component
	parent Name

	retired bool  // τ — set by O-Retire, monotone thereafter
	phase   Phase // θ — where in the lifecycle it stands

	// failed —— an activation that raised. The paper has no such state: Definition 48's effect
	// function is total, so §4.2 never asks what happens when one does not return. Cordis, which
	// runs real plugins, must: `_reload` catches, sets `this._error`, and `_setEpoch` then refuses
	// to act ("a failed fiber only recovers through update(), which clears _error").
	//
	// Without it the calculus livelocks on a broken component — L-Begin, raise, L-Unload,
	// Inactive, target still ≠ ⊥, L-Begin — forever, which is Theorem 73's termination lost
	// to a hypothesis the paper was entitled to make and an implementation is not.
	failed    bool
	committed View // ω, carried by every phase but Inactive

	table *Table    // σ_n — the bindings this fiber itself provides
	scope *Scope    // the accumulator g_n
	iter  *Iterator // the remaining iterator, while Reloading
}

func (f *fiber) installed() bool { return f.phase != PhaseInactive }

// Registry —— F_γ. The zero value is an empty registry.
type Registry struct {
	mu     sync.Mutex
	fibers map[Name]*fiber
	order  []Name // insertion order, so Names() can be written at all
	drawn  int    // counter for the fresh names Definition 52 draws
}

// Insert —— O-Insert, with all four premises.
func (r *Registry) Insert(n, parent Name, c Component) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.insertLocked(n, parent, c)
}

// Retire —— O-Retire. One premise, and it writes τ alone: retiring is a REQUEST, and the
// lifecycle rules are what carry it out.
func (r *Registry) Retire(n Name) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	f, ok := r.fibers[n]
	if !ok {
		return ErrUnknownFiber
	}
	f.retired = true // monotone: no rule writes it back (Lemma 59(5))
	return nil
}

// Remove —— O-Remove. Three premises, none of them optional: the entry may only be dropped once
// the system has already put everything back, which is what a `DELETE FROM installed_blocks` never
// establishes.
func (r *Registry) Remove(n Name) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	f, ok := r.fibers[n]
	if !ok {
		return ErrUnknownFiber
	}
	if !r.removable(n, f) {
		return ErrNotRemovable
	}
	delete(r.fibers, n)
	r.order = slices.DeleteFunc(r.order, func(o Name) bool { return o == n })
	return nil
}

// Instantiate —— Definition 52. The inverse is an O-Retire and not an O-Remove, because "an
// inverse has to apply wherever it is reached" and O-Remove carries premises that can fail.
func (r *Registry) Instantiate(parent Name, c Component) (Instantiation, error) {
	r.mu.Lock()
	r.init()
	if _, ok := r.fibers[parent]; !ok && parent != Root {
		r.mu.Unlock()
		return Instantiation{}, ErrUnknownParent
	}
	child := r.drawName()
	err := r.insertLocked(child, parent, c)
	r.mu.Unlock()

	if err != nil {
		return Instantiation{}, err
	}
	return Instantiation{
		Child: child,
		Undo:  func() error { return r.Retire(child) },
	}, nil
}

// drawName —— a fresh name, in the sense of Definition 50: "introducing a fiber simply draws
// one not already in use". Nothing reads it back; it is an atom.
func (r *Registry) drawName() Name {
	for {
		r.drawn++
		n := Name(fmt.Sprintf("fiber-%d", r.drawn))
		if _, taken := r.fibers[n]; !taken {
			return n
		}
	}
}

func (r *Registry) init() {
	if r.fibers == nil {
		r.fibers = make(map[Name]*fiber)
	}
}

func (r *Registry) insertLocked(n, parent Name, c Component) error {
	r.init()
	if err := r.checkInsertPremises(n, parent, c); err != nil {
		return err
	}
	r.fibers[n] = &fiber{
		comp:   c,
		parent: parent,
		phase:  PhaseInactive,
		table:  &Table{provision: c.Provides},
		scope:  &Scope{},
	}
	r.order = append(r.order, n)
	return nil
}

// checkInsertPremises —— O-Insert's four premises, in the order the rule writes them:
//
//	n ∉ dom(F_γ)   π ∈ dom(F_γ) ∪ {root}   (d,p,e) ∈ ℭ_Γ   ∀m ∈ dom(F_γ). p ∩ p_m = ∅
//
// The third is carried by the Go type: a Component IS a well-formed triple, so there is nothing to
// check. The other three are here.
func (r *Registry) checkInsertPremises(n, parent Name, c Component) error {
	if _, taken := r.fibers[n]; taken {
		return ErrNameTaken
	}
	if parent != Root {
		if _, ok := r.fibers[parent]; !ok {
			return ErrUnknownParent
		}
	}
	if r.provisionTaken(c.Provides) {
		return ErrProvisionOverlap
	}
	return nil
}

// provisionTaken —— O-Insert's fourth premise: ∀m ∈ dom(F_γ). p ∩ p_m = ∅.
//
// DECLARING, not installing. Two components that both name a key are refused before either one
// runs, which is strictly earlier than any collision could be observed and is what gives §4.3 a
// single possible provider per key to reason from.
func (r *Registry) provisionTaken(provides []string) bool {
	for _, other := range r.fibers {
		if overlaps(provides, other.comp.Provides) {
			return true
		}
	}
	return false
}

// removable —— O-Remove's three premises: τ_n = ⊤, θ_n = Inactive, σ_n = ∅, and ∀m.
// π_m ≠ n.
//
// None optional. The entry may only be dropped once the system has already put everything back —
// `σ_n = ∅` "admits only an entry holding no bindings, so that a removal discards none", and the
// parent clause removes children before their parent. A `DELETE FROM installed_blocks` establishes
// neither.
func (r *Registry) removable(n Name, f *fiber) bool {
	settled := f.retired && f.phase == PhaseInactive && len(f.table.Keys()) == 0
	return settled && !r.hasChildren(n)
}

// hasChildren —— O-Remove's `∀m. π_m ≠ n`, which keeps the tree well formed by removing
// children before their parent.
func (r *Registry) hasChildren(n Name) bool {
	for _, other := range r.fibers {
		if other.parent == n {
			return true
		}
	}
	return false
}
