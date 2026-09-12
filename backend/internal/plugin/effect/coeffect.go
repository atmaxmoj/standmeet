// coeffect.go —— the other half: §3.2 of arXiv:2608.25512, *reactive coeffects*.
//
// **Contract only. Every method panics.** Design: `docs/design/plugin/effects.md`.
//
// # Why this file has to exist next to effect.go
//
// Definition 20 is the join between the two halves, and it is easy to miss:
//
//	"set(k,v) has type 𝔈*_Σ, i.e. an effect function ON THE COEFFECT CONTEXT. We can therefore
//	 directly apply the effect machinery from Section 3.1… This is the synergy between reactive
//	 coeffects and revertible effects: coeffect operations ARE effects, and effects are
//	 revertible."
//
// So **providing a dependency is itself an effect**: `Set` hands back the inverse that withdraws
// the binding, and that inverse goes on the accumulator like any other. A supplier going away is
// not a special case handled by a supervisor — it is one disposer running, and everything that
// depended on it is deactivated by the same classification that activated it.
//
// Modelling the coeffect side as a read-only snapshot (a `Bind()` plus an `Epoch()`) — which is
// what the first draft of this package did — demotes a first-class revertible operation to a
// query, and loses exactly that.
//
// # What we already do, named properly
//
//	Σ                  the seam table; k is a seam name, V_k the supplier handle
//	set's precondition  k ∉ dom(σ) — this IS `plugin.NewResolver` refusing two suppliers of one
//	                   seam
//	d = Set(K)         a block's `requires:`
//	notify_d           activating / deactivating / neutral — what "recompute at every assembly"
//	                   approximates, minus the ability to say WHICH dependents moved
//	Σ^iso              per-code / per-session realms
//	Σ^inter            a code's deny-list: an enclosing context constraining how a component
//	                   uses a coeffect, without modifying that component

package effect

import "errors"

// ErrAlreadyBound —— `set` was called at a key already in dom(σ).
//
// Definition 20 makes `k ∉ dom(σ)` a **precondition**, and §3.2.1 is explicit about what a
// violated precondition does: "signalled as an error and produces **no transition**". Not
// last-wins, not first-wins-silently: the state does not move, so no dependent is ever told a
// different provider arrived.
var ErrAlreadyBound = errors.New("coeffect: key already bound")

// ErrNotBound —— `get` or restriction at a key outside dom(σ).
var ErrNotBound = errors.New("coeffect: key not bound")

// Notification —— Definition 22: how a transition σ → σ' classifies against a specification
// d.
//
//	activating    σ ⊭ d ∧ σ' ⊨ d   → run the component's effects
//	deactivating  σ ⊨ d ∧ σ' ⊭ d   → apply its accumulator
//	neutral       otherwise        → nothing
//
// "Classifying against the specification is what detects a change in satisfaction; responding to
// that classification is what drives activation and deactivation."
//
// One classification per specification, evaluated at every transition.
type Notification string

// Definition 22's three classifications of a context change, relative to one specification.
const (
	Activating   Notification = "activating"
	Deactivating Notification = "deactivating"
	Neutral      Notification = "" // the zero value: every transition the table does not name
)

// Spec —— Definition 21: `𝔇_Σ := Set(K)`, the dependencies a component declares.
type Spec []string

// Table —— Definition 19: the coeffect context `Σ := (k : K) ⇀ V_k`.
//
// The zero value is the empty table.

// Satisfied —— the predicate (22): `σ ⊨ d := ∀k ∈ d. k ∈ dom(σ)`.
//
// Decidable, because dom(σ) is finite; and because every mutation of σ passes through an effect
// function whose inverse recovers the previous domain, a change in satisfaction is detectable at
// every effect boundary. That is the algebraic reason reactivity needs no polling.

// Get —— Definition 20. Requires `k ∈ dom(σ)`; ErrNotBound otherwise.
//
// Note this is *not* "return nil if absent". §5.1.4 draws the distinction: a bare lookup that
// answers nothing and never fails is what lets a component proceed on an absent dependency; the
// coeffect discipline is that access is only reached at a state satisfying the specification, so an
// absent key here is a bug in the caller, not a value.

// Set —— Definition 20: binds v at k and **returns the inverse that withdraws it**.
//
//	set = (k,v) ↦ σ ↦ (σ[k ↦ v], λσ'. σ' \ k)
//
// The returned Dispose is what makes provision revertible, and it is why a supplier disappearing
// needs no supervisor: its Scope's accumulator already holds this.

// Notify —— Definition 22, evaluated for one specification across a transition this Table is
// about to make. Returned so a caller can act on the classification before the state moves.

// Isolate —— Definition 24/25: `Σ^iso := (K ⇀ R) × ((r : R) ⇀ V_r)`.
//
// Access resolves ρ(k) to a realm, then reads σ(r). `isolate(k,r) = (ρ[k↦r], σ)`.
//
// **Returns no inverse, and that is not an omission.** Definition 23 divides realizations: an
// *in-place* one mutates and returns a nontrivial inverse; a *derived* one leaves the input intact
// and returns a fresh context, "with the identity as its inverse; recovery discards the derived
// context". Isolation is derived — it changes how a key resolves for the components under one
// context, and nothing in the shared table changes, so there is no effect to track.
//
// This is the shape of per-code and per-session isolation: the same seam name resolving to
// different suppliers for different visitors, without any of them writing to a table the others
// read.

// Intercept —— Definition 26/27: `Σ^inter`, cross-cutting metadata on dependency access.
//
// The context carries ι; a component declares d(k); access evaluates `σ(k)(d(k) ⊕_k ι(k))`.
// The merge is **right-biased**, so the context's metadata takes priority — which is the whole
// point:
//
//	"letting an enclosing context constrain how a component uses a coeffect **without modifying
//	 that component**."
//
// That sentence describes an access code's deny-list exactly. A code that forbids a block from
// reaching part of the corpus is not editing the block; it is installing metadata on the context
// the block resolves its coeffect through. Also derived (no inverse), for the same reason as
// Isolate.

// Meta —— per-key interception metadata. Definition 27 equips each key with a monoid `(M_k,
// ⊕_k, ε_k)`: the merge is associative with the empty metadata as identity.
//
// A monoid and not an arbitrary function because interception composes: nesting two contexts that
// each constrain the same key must give one constraint, in a way that does not depend on how the
// nesting was bracketed.
type Meta interface {
	Merge(other Meta) Meta // ⊕_k, associative
	Empty() bool           // ε_k, the identity
}

// Coeffect —— Definition 29: a coeffect at a key is a pair `(V_k, A_k)` — a value type and
// the set of **coeffect operations** the bound value offers a component holding it:
//
//	a : X_a → V_k ⇀ V_k × (V_k ⇀ V_k) × B_a
//
// An operation returns the new value, **its own inverse**, and an outcome. So operating on a bound
// dependency is revertible in the same sense provision is — a calendar seam whose `insert_event`
// yields the delete that undoes it makes a booking revertible; one that exposes raw HTTP does not,
// and §6.1 puts such a location outside the system boundary, "neither tracked nor reverted".
//
// Witnessed (Definition 46) adds a third constituent: a proof that the key is **commutative**
// (Definition 44). The obligation falls on the component *providing* the key, not on any consumer
// — which is why a seam definition is the right place for it and a block's `requires:` is not.
type Coeffect struct {
	Key         string
	Operations  []string // A_k, by name
	Commutative bool     // Def 46's witness: the provider's, checked here, assumed nowhere

	// Revertible —— the provider's claim that every operation in the set above returns its own
	// inverse, in Definition 29's sense. §6.1 is what makes it a separate claim: reifying an
	// external location moves the system boundary only when access is confined "to a set of
	// operations it provides, EACH OF WHICH IT CAN SUPPLY AN INVERSE FOR", and whether an
	// implementation does that cannot be read off an operation's name.
	Revertible bool
}
