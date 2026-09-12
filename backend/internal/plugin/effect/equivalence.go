// equivalence.go —— §3.3.2 of arXiv:2608.25512: observational equivalence, the relation every
// equality in this package is read up to.
//
// **Contract only. Every method panics.** Design: `docs/design/plugin/effects.md`.
//
// # Why equality is the wrong predicate, in the paper's own words
//
//	"The recovery guarantee of Section 3.1 asserts an equality of states (Theorem 7), which is an
//	 IDEALIZATION, because the physical state cannot be recovered as it stood. For example, `free`
//	 releases a block to the allocator without restoring the layout the heap had before `malloc`;
//	 and a generative name is not restored by the inverse that discards it, since the next
//	 creation draws a fresh one. The equalities of Section 3 are therefore to be read up to an
//	 equivalence ≃."
//
// This is not a footnote. A `Scope` that provisions a postgres schema and drops it has *not*
// restored the database byte-for-byte: the next provision draws a fresh OID, the sequence counters
// have moved, the WAL is longer. An implementation that is correct in every sense the paper cares
// about fails a `reflect.DeepEqual` — so a test written that way rejects correct code, which is
// worse than one that accepts wrong code, because it will be "fixed" by weakening the real
// property.
//
// # What replaces it
//
// Definition 31: an observer of a value runs **the operations of its key** and reads their
// outcomes. A *test* is a finite word whose letters are forward maps and yielded inverses; two
// values are indistinguishable when every test is defined at both or at neither and yields the same
// outcomes.
//
// Definition 33 then relates whole contexts **at a set of keys S**, and the sentence that makes the
// whole thing work:
//
//	"The part of a state that no key binds is thereby FORGOTTEN, and forgetting it is what lets
//	 Theorem 7 be read up to ≃ at all: the heap layout and the generative name of the examples
//	 above lie outside the relation unless some key binds them."
//
// So: compare what the coeffect keys bind, through the operations those keys publish. Everything
// else is not part of the state as far as this theory is concerned — which is exactly the licence
// an implementation needs to allocate a fresh id on the way back.
//
// # The consequence that is easy to miss
//
// Definition 34 extends ≃ along the type formers, and §3.3.2 warns:
//
//	"Substituting ≃ for = throughout is not by itself enough, because an effect function returns
//	 an INVERSE as well as a state, and two states that ≃ identifies have to yield inverses ≃
//	 identifies as well."
//
// `Equivalent` below therefore compares states; `RespectedBy` is the separate obligation on an
// operation, and Lemma 32 is what makes it checkable: ≈ is the **coarsest** equivalence every
// operation respects, so an operation that fails to respect it is telling you the key publishes an
// observation the relation has to be refined by.

package effect

// Outcome —— what a test letter yields. Definition 31: "outcomes are those the letters that are
// forward maps yield along the way, and it is undefined where a precondition fails".
type Outcome struct {
	Value   any
	Defined bool // false where a precondition failed — and "undefined at both" counts as agreement
}

// Op —— one letter of a test: an operation of a key, in the sense of Definition 29. Applied to
// the value left by the letters before it.
type Op func(v any) Outcome

// Test —— Definition 31: a finite word of operations over one key's A_k.
//
// Deliberately a *word*, not a single call. One operation agreeing proves very little; the theory's
// indistinguishability quantifies over sequences, and the cases that separate two values are
// usually two operations deep — provision then read, or read then provision.
type Test []Op

// Indistinguishable —— `v ≈_A v'` (Def 31): every test in the suite is defined at both or at
// neither, and yields the same outcomes at both.

// Equivalent —— `σ ≃_S σ'` (Def 33): the two contexts bind the same keys **of S**, and at
// each such key the bound values are indistinguishable under that key's own operations.
//
// S is the point. Passing the keys a component declares (Definition 48) reads each claim "at the
// restriction that component's own declarations name" — so a test asserts what *this* component
// can observe, and stays silent about everything it cannot. A comparison over every key in the
// instance would drag the heap layout back in through the door the paper just closed.

// RespectedBy —— Lemma 32's obligation, stated so it can be checked rather than assumed.
//
// "An operation *respects* an equivalence when, at related values, it is defined at both or at
// neither and, where defined, yields related successors, inverses carrying related values to
// related values, and equal outcomes."
//
// Worth its own method because ≈ is the **coarsest** relation every operation respects (Lemma
// 32.2): if an operation does not respect it, the key is publishing an observation that the
// relation must be refined by — which is a fact about the seam's contract, not a bug in the test.

// Observers —— the operations a key publishes, i.e. its A_k. A seam definition supplies this;
// it is the same list `Coeffect.Operations` names, in callable form.
//
// A key that publishes **fewer** operations has a coarser ≈, and §3.4.2 turns that into a design
// lever rather than an accident:
//
//	"≈_k is indistinguishability under the tests the operations of k generate, and an interface
//	 publishing fewer outcomes admits fewer tests and coarsens the relation, which can carry a key
//	 from one side of a division to the other."
//
// Concretely: a calendar seam that returns the provider's event id makes two bookings
// distinguishable and the key non-commutative; one that returns only success does not. **What a
// seam chooses to return decides whether its operations commute** — and therefore whether Theorem
// 43 lets its effects be reverted in any order.
