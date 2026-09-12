// registry_wellformed.go —— Definition 63, the invariant Theorem 64 (Preservation) preserves.
//
// One function per clause, because that is how the definition is written and how a failure has
// to be read back: "Def 63 clause (3) broken after L-Begin(cal)" says where to look, and a
// single boolean does not.
//
// This is a claim about EVERY intermediate state, not about quiescence. Checking it only when the
// registry settles would miss exactly the states it exists to rule out — a committed view naming a
// fiber that has been removed, two tables claiming one key, a parent pointer into nothing — because
// each of those is repaired by the next rule and invisible by the time everything is quiet.

package effect

// WellFormed —— Definition 63's four clauses, returning the one that failed.
//
// One function per clause, because that is how the definition is written and how a failure has to
// be read back: "Def 63 clause (3) broken after L-Begin(cal)" says where to look, and a single
// boolean does not.
func (r *Registry) WellFormed() (int, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for n, f := range r.fibers {
		if !r.parentIsRegistered(f) {
			return 1, false
		}
		if !r.provisionsAreDisjoint(n, f) {
			return 2, false
		}
		if clause, ok := r.viewIsWellFormed(f); !ok {
			return clause, false
		}
	}
	return 0, true
}

// clause (1) —— π_n ∈ dom(F_γ) ∪ {root}: the tree of Definition 50, read one edge at a
// time.
func (r *Registry) parentIsRegistered(f *fiber) bool {
	if f.parent == Root {
		return true
	}
	_, ok := r.fibers[f.parent]
	return ok
}

// clause (2) —— m ≠ n ⇒ p_m ∩ p_n = ∅: the single-source discipline, as an invariant
// rather than as O-Insert's premise. Two consequences §4.3 uses rest on it: distinct tables are
// disjoint, so σ_γ is a function; and a key has at most one possible provider.
func (r *Registry) provisionsAreDisjoint(n Name, f *fiber) bool {
	for m, g := range r.fibers {
		if m != n && overlaps(f.comp.Provides, g.comp.Provides) {
			return false
		}
	}
	return true
}

// overlaps —— do two provisions share a key? The predicate O-Insert's fourth premise and
// Definition 63's clause (2) are both written against.
func overlaps(a, b []string) bool {
	for _, k := range a {
		if declares(b, k) {
			return true
		}
	}
	return false
}

// clauses (3) and (4) —— an installed fiber's ω is total on d_n and valued in dom(F_γ), and
// every fiber it names is itself installed. Together they are why a committed view can be followed:
// a consumer reading its coeffect through ω never lands on an entry that has gone.
func (r *Registry) viewIsWellFormed(f *fiber) (int, bool) {
	if !f.installed() {
		return 0, true
	}
	for _, k := range f.comp.Requires {
		if clause, ok := r.viewAtKey(f, k); !ok {
			return clause, false
		}
	}
	return 0, true
}

// viewAtKey —— clause (3) then clause (4) at one declared key: ω names a fiber, that fiber is
// in the registry, and it is installed. Together they are why a committed view can be FOLLOWED —
// a consumer reading its coeffect through ω never lands on an entry that has gone.
func (r *Registry) viewAtKey(f *fiber, k string) (int, bool) {
	m, bound := f.committed[k]
	if !bound {
		return clauseViewTotal, false
	}
	target, ok := r.fibers[m]
	if !ok {
		return clauseViewTotal, false
	}
	if !target.installed() {
		return clauseViewInstalled, false
	}
	return 0, true
}

// The clause numbers of Definition 63, named so a failure report says which invariant broke.
const (
	clauseViewTotal     = 3
	clauseViewInstalled = 4
)
