// support.go —— §4.3.4, §4.3.5 and §6.5: what the declarations alone decide, before anything
// runs.
//
// Everything here reads `Requires`, `Provides`, the parent pointer and the retirement flag, and
// **no runtime state at all**. That is the property worth having a file for: each of these answers
// a question an owner asks about a system that has not settled yet, or will not.
//
//   - `Precedes` / `Cycles` — will this ever come up, and if not, which components are the ring?
//   - `Support` — which components will be running when it does settle?
//   - `Total` — do the theorems below apply to this system at all?
//
// The two theorems of §4.3 that matter most (Progress, Confluence) are both stated **on the
// hypothesis that ≺ is acyclic**, and the paper is careful that it "is an assumption and not
// something the definition delivers". A hypothesis a system can violate is worth being able to
// check, which is why these are on the contract rather than left implicit.
//
// **Contract only. Every method panics.** Design: `docs/design/plugin/effects.md`.

package effect

import "errors"

// Precedes —— Definition 72: `n ≺ m := p_n ∩ d_m ≠ ∅`, "so that n may provide a key m
// declares".
//
// "It reads d and p alone", which is the entire point: the activation order is a function of the
// declarations, computable before anything runs.
//
// What ≺ orders is the two fibers' **activations** and not their lifetimes — `n ≺ m` says n
// has to become Active before m can. That a provider *outlives* its consumer is Theorem 70(2), a
// different claim, about the guarded calculus rather than about the declarations.

// Independent —— Theorem 47, read off the two components' declarations:
//
//	P₁ ∩ S₂ = P₂ ∩ S₁ = ∅, and every key at which operations of both occur is commutative ⇒ i₁ and
//	 i₂ are independent (Definition 42)
//
// Neither provides what the other requires, and any key they share commutes. The paper's closing
// sentence on it is the one that makes this a method rather than a proof obligation:
//
//	"With every coeffect witnessed, the commutativity hypothesis of Theorem 47 is supplied at
//	 every key (Definition 46), and only the disjointness P₁ ∩ S₂ = P₂ ∩ S₁ = ∅
//	 remains to be checked of a pair; **Section 4 reads that disjointness off the two components'
//	 declarations.**"
//
// So independence — which Theorem 43 turns into "these may be reverted in any order", and Lemma
// 78 into "these two steps may be transposed" — is a **syntactic check on two manifests**. No
// tracing, no runtime observation, no annotation by the component author beyond what they already
// declare.
//
// Lemma 66 is the consequence at the level of the whole calculus: *every* sequence of steps is
// pairwise independent, because the rules admit no pair that is not.

// Cycles —— the ≺-cycles among the inserted fibers, each as the names around it.
//
// §6.5 is the sentence that makes this method worth having:
//
//	"A dependency cycle simply leaves the involved components permanently inactive… Unlike
//	 deadlock in concurrent systems, which depends on the schedule and must be detected as it
//	 happens, THIS CONDITION IS PREDICTABLE FROM THE DEPENDENCY DECLARATIONS ALONE, so a runtime
//	 can report it when components are loaded."
//
// So a cycle is reportable at install, **with the names in it**, rather than showing up as two
// blocks that sit at "waiting" forever and an owner with no way to find out why. Note that `n ≺
// n` holds of a component declaring a key it provides itself, so a self-cycle is a real case and
// not a degenerate one.

// Support —— Definition 74, equation (62): the fibers that end up Active, computed from `τ,
// π, d, p` and **nothing else**.
//
//	n ∈ A := ¬τ_n ∧ (π_n = root ∨ π_n ∈ A) ∧ ∀k ∈ d_n. ∃m ∈ A. k ∈ p_m
//
// A recursion along `⊲ := ≺ ∪ parent`, well founded by Lemma 75, so it has exactly one
// solution.
//
// "The first fixes the set of fibers that end up Active without reference to any sequence of steps,
// which is what makes it a function of the input rather than of the schedule." Lemma 77 then
// equates it with the Active set at quiescence, given Definition 76's totality.
//
// This is the answer to "what will be running when this settles", available before it settles —
// and therefore the answer to "why is my block still waiting", which is otherwise a question only a
// log can answer.

// Total —— Definition 76: a component is *total on its provision* when an activation of it that
// finishes has installed every key of p, so that `dom(σ_n) = p_n` at every Active fiber
// instantiating it.
//
// A condition on the component alone, "mentioning no lifecycle state and no step". It is what
// closes the gap between the support set (which reads `p`, the keys a component **may** install)
// and the Active set (which reads `dom(σ_γ)`, the keys it **has**).
//
// A hypothesis of Lemma 77 and hence of Confluence, so a component that provides a key only
// sometimes puts the system outside Theorem 80 — worth detecting rather than assuming.

// ── Errors ────────────────────────────────────────────────────────────────────

// ErrProvisionOverlap —— O-Insert's fourth premise: another fiber already declares a key of p.
var ErrProvisionOverlap = errors.New("effect: another fiber already declares one of these keys")

// ErrNameTaken —— O-Insert's first premise.
var ErrNameTaken = errors.New("effect: a fiber of that name is already registered")

// ErrUnknownParent —— O-Insert's second premise: π ∉ dom(F_γ) ∪ {root}.
var ErrUnknownParent = errors.New("effect: parent fiber is not registered")

// ErrNotRemovable —— O-Remove's premises: not retired, not Inactive, still holds bindings, or
// still has children. One error because the caller's move is the same in every case: let the
// lifecycle rules run, then try again.
var ErrNotRemovable = errors.New("effect: fiber is not yet removable")

// ErrUnknownFiber —— a rule was asked for at a name not in the registry.
var ErrUnknownFiber = errors.New("effect: no such fiber")

// ErrOutsideProvision —— Definition 48: an effect function installed a binding at a key outside
// its component's declared provision. A violation of the component's own declaration, and
// detectable at the moment of the write.
var ErrOutsideProvision = errors.New("effect: installed a key outside the declared provision")

// ErrNoProgress —— Settle found the registry not quiet and no lifecycle rule applicable.
// Theorem 73(1) says this cannot happen under an acyclic ≺; it is reported rather than looped on
// because if it ever occurs, the assumption has been violated somewhere and silence would be the
// worst outcome.
var ErrNoProgress = errors.New("effect: not quiet, and no lifecycle rule applies")
