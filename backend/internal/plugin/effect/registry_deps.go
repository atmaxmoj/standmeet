// registry_deps.go —— what an effect function is handed, and the static predictions §4.3 rests
// on. Contract: fiber.go (Deps) and support.go.

package effect

import "slices"

// depsLocked —— Definition 55's confinement, built as a value rather than enforced as a rule.
//
// The component gets its own table, its committed view, and an operation that reaches ONLY the keys
// it declared. It never gets the registry, so it cannot branch on another fiber's lifecycle state
// — which is what lets §4.3 read Table 1 as a complete inventory of the writes.
func (r *Registry) depsLocked(f *fiber, view View) Deps {
	return Deps{
		View: view,
		Own:  f.table,
		Use: func(k string, op Op) (Outcome, Dispose, error) {
			// Clause (2): a key outside the two declarations is neither readable nor writable.
			if !declares(f.comp.Requires, k) {
				return Outcome{}, nil, ErrNotBound
			}
			r.mu.Lock()
			provider := view[k]
			pf := r.fibers[provider]
			r.mu.Unlock()
			if pf == nil {
				return Outcome{}, nil, ErrNotBound
			}
			// Clause (1)'s one permitted write outside the fiber's own table: the value at a
			// declared key lives in the PROVIDER's table.
			v, err := pf.table.Get(k)
			if err != nil {
				return Outcome{}, nil, err
			}
			return op(v), func() error { return nil }, nil
		},
	}
}

func declares(spec []string, k string) bool {
	return slices.Contains(spec, k)
}

// Precedes —— Definition 72: `n ≺ m := p_n ∩ d_m ≠ ∅`. Reads d and p alone.
func (r *Registry) Precedes(n, m Name) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.precedesLocked(n, m)
}

func (r *Registry) precedesLocked(n, m Name) bool {
	a, b := r.fibers[n], r.fibers[m]
	if a == nil || b == nil {
		return false
	}
	for _, p := range a.comp.Provides {
		if declares(b.comp.Requires, p) {
			return true
		}
	}
	return false
}

// Independent —— Theorem 47, read off two manifests: `P₁ ∩ S₂ = P₂ ∩ S₁ = ∅`.
//
// The commutativity half of the hypothesis is the provider's to witness (Definition 46), so what
// remains to check of a pair is the disjointness — and §4 says that is read off the
// declarations.
func (r *Registry) Independent(n, m Name) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if n == m {
		return false
	}
	return !r.precedesLocked(n, m) && !r.precedesLocked(m, n)
}

// Cycles —— the ≺-cycles among the inserted fibers.
//
// §6.5: a dependency cycle leaves its components permanently inactive, and "unlike deadlock…
// this condition is predictable from the dependency declarations alone", so it is reportable at
// load with the names in it rather than as two blocks stuck at "waiting" and nobody able to say
// why.
func (r *Registry) Cycles() [][]Name {
	r.mu.Lock()
	defer r.mu.Unlock()

	w := &ringWalk{reg: r, colour: map[Name]int{}}
	for _, n := range r.order {
		if w.colour[n] == unvisited {
			w.walk(n)
		}
	}
	return w.found
}

// ringWalk —— a depth-first walk over ≺, collecting the cycles it closes.
//
// Ordinary three-colour cycle detection; the only part worth a name is `ringFrom`, which turns
// "this edge closes a cycle" into the NAMES around it — and the names are the whole value of the
// report.
type ringWalk struct {
	reg    *Registry
	colour map[Name]int
	stack  []Name
	found  [][]Name
}

const (
	unvisited = iota
	onStack
	done
)

func (w *ringWalk) walk(n Name) {
	w.colour[n] = onStack
	w.stack = append(w.stack, n)
	for _, m := range w.reg.order {
		if w.reg.precedesLocked(n, m) {
			w.visit(m)
		}
	}
	w.stack = w.stack[:len(w.stack)-1]
	w.colour[n] = done
}

// visit —— follow one ≺ edge: descend into an unvisited node, or record the ring an edge back
// onto the stack has just closed.
func (w *ringWalk) visit(m Name) {
	switch w.colour[m] {
	case unvisited:
		w.walk(m)
	case onStack:
		w.found = append(w.found, w.ringFrom(m))
	default: // done: that subtree is closed and carries no edge back into the stack
	}
}

// ringFrom —— the members of the ring this edge closed: everything from m to the top of the
// stack.
func (w *ringWalk) ringFrom(m Name) []Name {
	for i, s := range w.stack {
		if s == m {
			return append([]Name{}, w.stack[i:]...)
		}
	}
	return []Name{} // unreachable: m is on the stack, or this edge did not close a ring
}

// Support —— Definition 74: the fibers that end up Active, from `τ, π, d, p` and nothing
// else.
//
//	n ∈ A := ¬τ_n ∧ (π_n = root ∨ π_n ∈ A) ∧ ∀k ∈ d_n. ∃m ∈ A. k ∈ p_m
//
// A recursion along `⊲ := ≺ ∪ parent`, well founded by Lemma 75, so it has exactly one
// solution.
func (r *Registry) Support() []Name {
	r.mu.Lock()
	defer r.mu.Unlock()

	// A LEAST fixed point, built upward. Definition 74 is a recursion ALONG ⊲, well founded by
	// Lemma 75, so a fiber is supported only once everything below it already is. Starting from
	// "everything unretired" and removing failures would compute the greatest fixed point instead,
	// and that one keeps a ≺-ring: each member's dependency is provided by the other, so neither
	// is ever removed. §6.5 says a ring "simply leaves the involved components permanently
	// inactive", which is exactly what the least fixed point yields and the greatest one hides.
	in := map[Name]bool{}
	for r.admitOne(in) {
		// one clause of Definition 74 discharged per pass, upward along ⊲
	}

	var out []Name
	for _, n := range r.order {
		if in[n] {
			out = append(out, n)
		}
	}
	return out
}

// admitOne —— add every fiber whose clauses now hold, and report whether any was added.
//
// Upward, never downward: `n ∈ A` requires everything below n to be in A already, so a fiber
// joins only once its parent and all its providers have. A ring never qualifies, which is
// Definition 74 yielding what §6.5 describes — "permanently inactive".
func (r *Registry) admitOne(in map[Name]bool) bool {
	added := false
	for _, n := range r.order {
		if r.qualifies(in, n) {
			in[n] = true
			added = true
		}
	}
	return added
}

// qualifies —— do Definition 74's three clauses hold for n, given what is already in A?
//
//	n ∈ A := ¬τ_n ∧ (π_n = root ∨ π_n ∈ A) ∧ ∀k ∈ d_n. ∃m ∈ A. k ∈ p_m
func (r *Registry) qualifies(in map[Name]bool, n Name) bool {
	f := r.fibers[n]
	if f == nil || in[n] || f.retired {
		return false // already in A, gone, or retired: nothing to admit
	}
	return r.parentAdmitted(in, f) && satisfiedBy(r, in, f.comp.Requires)
}

// parentAdmitted —— `π_n = root ∨ π_n ∈ A`. A fiber some activation instantiated is
// supported only while its instantiator is: Definition 52's inverse retires the child, so a parent
// outside A takes its children with it.
func (r *Registry) parentAdmitted(in map[Name]bool, f *fiber) bool {
	return f.parent == Root || in[f.parent]
}

func satisfiedBy(r *Registry, in map[Name]bool, requires []string) bool {
	for _, k := range requires {
		if !r.providedBy(in, k) {
			return false
		}
	}
	return true
}

func (r *Registry) providedBy(in map[Name]bool, k string) bool {
	for m, ok := range in {
		if !ok {
			continue
		}
		if f := r.fibers[m]; f != nil && declares(f.comp.Provides, k) {
			return true
		}
	}
	return false
}

// Total —— Definition 76: an activation that finishes has installed EVERY key of p, so that
// `dom(σ_n) = p_n` at every Active fiber of the component.
//
// A hypothesis of Lemma 77 and hence of Confluence. A component that provides a key only sometimes
// puts the system outside Theorem 80, which is worth detecting rather than assuming.
func (r *Registry) Total(n Name) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	f := r.fibers[n]
	if f == nil {
		return false
	}
	if f.phase != PhaseActive {
		return true // the condition speaks only of Active fibers
	}
	for _, k := range f.comp.Provides {
		if _, err := f.table.Get(k); err != nil {
			return false
		}
	}
	return true
}
