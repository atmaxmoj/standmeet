// table.go —— the implementation of §3.2's coeffect context Σ. Contract: coeffect.go.
//
// Two things here are easy to get backwards, and both are Definition 23's division between an
// IN-PLACE realization and a DERIVED one:
//
//   - `Set` is in place. It mutates the table and returns a nontrivial inverse, which is what makes
//     provision revertible and why a supplier going away needs no supervisor.
//   - `Isolate` and `Intercept` are derived. They leave the input table untouched and return a
//     fresh one, "with the identity as its inverse; recovery discards the derived context". They
//     return no Dispose because there is nothing to undo — and that is the whole reason
//     per-session seam resolution costs nothing to clean up.

package effect

import (
	"maps"
	"sync"
)

// Table —— Σ. The zero value is the empty table; a derived one carries a parent it reads
// through.
type Table struct {
	mu     sync.Mutex
	parent *Table
	owner  *Scope
	own    map[string]any

	// realm —— the keys Definition 24 has isolated in THIS derivation. A key listed here is
	// read and written locally: the parent's binding at it is invisible, which is what makes two
	// realms two independent resolutions of one seam name.
	realm map[string]string

	// meta —— Definition 27's ι, the interception metadata an enclosing context installs.
	meta map[string]Meta

	// provision —— p, when this table is a fiber's own σ_n. Definition 48: "no key outside p
	// is one its effect function installs a binding at", so a Set outside it is refused at the
	// moment of the write. nil means unconstrained, which is what a bare Table is.
	provision []string
}

// Satisfied —— `σ ⊨ d := ∀k ∈ d. k ∈ dom(σ)`.
func (t *Table) Satisfied(d Spec) bool {
	for _, k := range d {
		if _, ok := t.lookup(k); !ok {
			return false
		}
	}
	return true
}

// Get —— Definition 20's access. An absent key is a bug in the caller, not a value: the
// coeffect discipline is that access is only reached at a state satisfying the specification.
func (t *Table) Get(k string) (any, error) {
	v, ok := t.lookup(k)
	if !ok {
		return nil, ErrNotBound
	}
	// Definition 26: access evaluates `σ(k)(d(k) ⊕_k ι(k))` — the bound value is READ THROUGH
	// the interception metadata in force, never bare. A context that constrains a key and then
	// hands the unconstrained value to its callers has installed a decoration, not a constraint.
	if m := t.MetaAt(k); m != nil && !m.Empty() {
		return Constrained{Value: v, Meta: m}, nil
	}
	return v, nil
}

// Constrained —— a bound value read through interception metadata.
//
// Definition 27's ⊕ has already happened by the time this exists: `Intercept` merges right-biased
// on the way down, so `Meta` here is the whole of what the enclosing contexts asked for. The
// consumer gets the value AND the constraint together, which is the only arrangement in which it
// cannot use one without the other.
type Constrained struct {
	Value any
	Meta  Meta
}

// Set —— `set = (k,v) ↦ σ ↦ (σ[k ↦ v], λσ'. σ' \ k)`.
//
// The precondition `k ∉ dom(σ)` is checked FIRST and a violation "produces no transition": the
// table does not move, so no dependent is ever told a different provider arrived.
func (t *Table) Set(k string, v any) (Dispose, error) {
	if t.provision != nil && !declares(t.provision, k) {
		return nil, ErrOutsideProvision
	}
	if _, bound := t.lookup(k); bound {
		return nil, ErrAlreadyBound
	}

	t.mu.Lock()
	if t.own == nil {
		t.own = make(map[string]any)
	}
	t.own[k] = v
	t.mu.Unlock()

	var once sync.Once
	return func() error {
		once.Do(func() {
			t.mu.Lock()
			delete(t.own, k)
			t.mu.Unlock()
		})
		return nil
	}, nil
}

// Notify —— Definition 22, evaluated across the transition `next` makes.
//
// The classification is read from satisfaction BEFORE and AFTER, which is why reactivity needs no
// polling: every mutation of σ passes through an effect function, so a change in satisfaction is
// detectable at every effect boundary.
func (t *Table) Notify(d Spec, next func()) Notification {
	before := t.Satisfied(d)
	next()
	return classify(before, t.Satisfied(d))
}

// classify —— Definition 22's three cases, on satisfaction before and after.
func classify(before, after bool) Notification {
	return notifications[[2]bool{before, after}]
}

// notifications —— Definition 22's table, verbatim. Every pair not named here is `neutral`,
// which is the zero value, so the two transitions that MATTER are the only two written down.
var notifications = map[[2]bool]Notification{
	{false, true}: Activating,   // σ ⊭ d ∧ σ' ⊨ d → run the component's effects
	{true, false}: Deactivating, // σ ⊨ d ∧ σ' ⊭ d → apply its accumulator
}

// Isolate —— `isolate(k,r) = (ρ[k↦r], σ)`. Derived: nothing in the shared table changes, so
// there is no effect to track and no inverse to return.
func (t *Table) Isolate(k, realm string) *Table {
	next := t.derive()
	if next.realm == nil {
		next.realm = make(map[string]string)
	}
	next.realm[k] = realm
	return next
}

// Intercept —— `Σ^inter`. The merge is right-biased, so an enclosing context's metadata takes
// priority: that is what lets a code constrain how a block uses a coeffect WITHOUT modifying the
// block. Derived, for the same reason as Isolate.
func (t *Table) Intercept(k string, meta Meta) *Table {
	next := t.derive()
	if next.meta == nil {
		next.meta = make(map[string]Meta)
	}
	if prior, ok := next.meta[k]; ok && prior != nil {
		next.meta[k] = prior.Merge(meta) // right-biased: the enclosing context wins
	} else {
		next.meta[k] = meta
	}
	return next
}

// MetaAt —— the interception metadata in force at a key, or nil.
//
// Exposed because Definition 27's constraint is only observable at the point of access: a component
// reads its coeffect through the context, and the context is what carries ι. compose, and a
// concrete type here would make that impossible.
//
//nolint:ireturn // Def 27 types ι at the MONOID interface: metadata from two providers must
func (t *Table) MetaAt(k string) Meta {
	t.mu.Lock()
	m, ok := t.meta[k]
	parent := t.parent
	t.mu.Unlock()
	if ok {
		return m
	}
	if parent == nil {
		return nil
	}
	return parent.MetaAt(k)
}

// Keys —— dom(σ) as this derivation sees it, including what it reads through its parent.
func (t *Table) Keys() []string {
	seen := map[string]bool{}
	var out []string
	for cur := t; cur != nil; {
		cur = cur.collect(seen, &out)
	}
	return out
}

// collect —— add this derivation's own keys to the accumulator and return the parent to
// continue with, or nil.
//
// A key this derivation ISOLATED is marked seen without being added: Definition 24 makes the
// parent's binding at that key invisible here, so the walk must not pick it up further up.
func (t *Table) collect(seen map[string]bool, out *[]string) *Table {
	t.mu.Lock()
	defer t.mu.Unlock()
	for k := range t.own {
		if !seen[k] {
			seen[k] = true
			*out = append(*out, k)
		}
	}
	for k := range t.realm {
		seen[k] = true
	}
	return t.parent
}

// lookup —— walk the parent chain, stopping at a key this derivation isolated.
func (t *Table) lookup(k string) (any, bool) {
	t.mu.Lock()
	if v, ok := t.own[k]; ok {
		t.mu.Unlock()
		return v, true
	}
	_, isolated := t.realm[k]
	parent := t.parent
	t.mu.Unlock()

	if isolated || parent == nil {
		return nil, false
	}
	return parent.lookup(k)
}

// derive —— a fresh context reading through this one: Definition 23's derived realization.
func (t *Table) derive() *Table {
	t.mu.Lock()
	defer t.mu.Unlock()
	next := &Table{parent: t, owner: t.owner}
	if len(t.realm) > 0 {
		next.realm = maps.Clone(t.realm)
	}
	if len(t.meta) > 0 {
		next.meta = maps.Clone(t.meta)
	}
	return next
}
