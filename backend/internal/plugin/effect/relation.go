// relation.go —— the implementation of §3.3.2's observational equivalence. Contract:
// equivalence.go.
//
// The one thing to keep straight: a test is a WORD, and it is run against a value, in order, letter
// by letter. Definition 31's outcomes are "those the letters that are forward maps yield along the
// way, and it is undefined where a precondition fails" — so a word that goes undefined at letter
// two yields the outcomes of letter one and then stops, and two values agree only if they stop in
// the same place with the same outcomes behind them.

package effect

import "strings"

// voidSuffix —— the naming convention by which a seam declares that an operation reports
// success and nothing else. §3.4.2: "an interface publishing fewer outcomes admits fewer tests and
// coarsens the relation, which can carry a key from one side of a division to the other" — so
// this suffix is the quiet end of that lever, spelled in the declaration rather than discovered.
const voidSuffix = "_void"

// runTest —— apply a word to a value, collecting outcomes until one goes undefined.
//
// Each letter is applied to the SAME value, in order. Definition 29 gives an operation the type
// `V_k ⇀ V_k × (V_k ⇀ V_k) × B_a` — it transforms the bound value in place and reports an
// outcome — so what distinguishes "provision then read" from "read then provision" is the order
// the letters run in, not a value handed between them. Threading the OUTCOME onward instead would
// feed letter two whatever letter one reported, which is a different (and wrong) reading of the
// word.
func runTest(v any, word Test) []Outcome {
	out := make([]Outcome, 0, len(word))
	for _, op := range word {
		if op == nil {
			continue
		}
		o := op(v)
		out = append(out, o)
		if !o.Defined {
			return out // a failed precondition ends the word
		}
	}
	return out
}

// sameOutcomes —— agreement in Definition 31's sense: same length, and at each position defined
// at both or at neither, with equal values where defined.
//
// "Undefined at both counts as agreement" is the half that is easy to drop, and dropping it makes
// every empty table distinguishable from every other.
func sameOutcomes(a, b []Outcome) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !agrees(a[i], b[i]) {
			return false
		}
	}
	return true
}

// agrees —— one position of Definition 31's comparison: defined at both or at neither, and
// equal where defined. "Undefined at both counts as agreement" is the half that is easy to drop.
func agrees(a, b Outcome) bool {
	if a.Defined != b.Defined {
		return false
	}
	return !a.Defined || comparableEqual(a.Value, b.Value)
}

// comparableEqual —— equality on what an outcome carries.
//
// Deliberately shallow: an outcome is what an operation REPORTS, and a key that reports a structure
// deep enough to need a recursive comparison is a key publishing more observations than its
// interface admits — which §3.4.2 says will carry it to the non-commutative side of the
// division.
func comparableEqual(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	// Incomparable dynamic types panic on ==; an outcome carrying one is reporting something no
	// key's operations should publish, and the honest answer is "these differ".
	defer func() { _ = recover() }() //nolint:errcheck // recover's value is the signal, not a value
	return a == b
}

// Indistinguishable —— `v ≈_A v'` (Definition 31).
func Indistinguishable(a, b any, suite []Test) bool {
	for _, word := range suite {
		if !sameOutcomes(runTest(a, word), runTest(b, word)) {
			return false
		}
	}
	return true
}

// Equivalent —— `σ ≃_S σ'` (Definition 33): the two contexts bind the same keys OF S, and
// at each such key the bound values are indistinguishable under that key's own operations.
//
// Presence is compared before value. Definition 33 requires `dom(σ) ∩ S = dom(σ') ∩ S` first,
// and dropping that half is how "the key is gone" and "the key is bound to nothing" stop being
// distinguishable — which is the one difference an uninstall has to get right.
//
// Everything outside S is forgotten, and that forgetting is what makes Theorem 7 readable at all:
// the heap layout and the generative name "lie outside the relation unless some key binds them".
func (t *Table) Equivalent(other *Table, s []string) bool {
	if other == nil {
		other = &Table{}
	}
	for _, k := range s {
		if !sameAt(t, other, k) {
			return false
		}
	}
	return true
}

// sameAt —— Definition 33 at one key: present in both or in neither, and indistinguishable
// where present.
//
// Presence BEFORE value. Def 33 requires `dom(σ) ∩ S = dom(σ') ∩ S` first, and dropping that
// half is how "the key is gone" and "the key is bound to nothing" stop being distinguishable —
// the one difference an uninstall has to get right.
func sameAt(a, b *Table, k string) bool {
	mine, hasMine := a.lookup(k)
	theirs, hasTheirs := b.lookup(k)
	if hasMine != hasTheirs {
		return false
	}
	if !hasMine {
		return true // undefined at both: agreement
	}
	return Indistinguishable(mine, theirs, []Test{{identity}})
}

// identity —— the one-letter test every key admits: read the bound value.
//
// A key publishing richer operations refines the relation (Lemma 32.2 makes ≈ the COARSEST
// relation every operation respects), and `Coeffect.Observers` is where those come from. This is
// the floor.
func identity(v any) Outcome { return Outcome{Value: v, Defined: true} }

// RespectedBy —— Lemma 32's obligation, checkable rather than assumed.
//
// "An operation respects an equivalence when, at related values, it is defined at both or at
// neither and, where defined, yields related successors… and equal outcomes."
//
// So: given two values the suite cannot tell apart, the operation must not tell them apart either.
// If it does, the key is publishing an observation the relation has to be refined by — a fact
// about the seam's contract, not a bug in the test.
func RespectedBy(op Op, a, b any, suite []Test) bool {
	if !Indistinguishable(a, b, suite) {
		return true // unrelated inputs place no obligation on the operation
	}
	if op == nil {
		return true
	}
	return sameOutcomes([]Outcome{op(a)}, []Outcome{op(b)})
}

// Observers —— the operations a key publishes, i.e. its A_k, in callable form.
//
// §3.4.2 turns the SIZE of this set into a design lever: "an interface publishing fewer outcomes
// admits fewer tests and coarsens the relation, which can carry a key from one side of a division
// to the other". A calendar seam returning the provider's event id makes two bookings
// distinguishable and the key non-commutative; one returning only success does not.
//
// An operation whose name ends in `_void` reports nothing beyond having happened — the quiet end
// of that lever, spelled in the declaration so the seam's author is choosing it rather than
// discovering it.
func (c Coeffect) Observers() []Op {
	out := make([]Op, 0, len(c.Operations))
	for _, name := range c.Operations {
		out = append(out, observerFor(name))
	}
	return out
}

func observerFor(name string) Op {
	if strings.HasSuffix(name, voidSuffix) && len(name) > len(voidSuffix) {
		// Publishes success and nothing else: every value looks alike through it.
		return func(any) Outcome { return Outcome{Value: true, Defined: true} }
	}
	return func(v any) Outcome {
		if o, ok := v.(interface{ Observe(name string) Outcome }); ok {
			return o.Observe(name)
		}
		return Outcome{Value: v, Defined: true}
	}
}
