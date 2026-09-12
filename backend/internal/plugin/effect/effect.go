// Package effect is the revertible-effect mechanism from *Spatiotemporal Composability*
// (arXiv:2608.25512) §3.1, ported from Cordis (`packages/core/src/fiber.ts`, MIT, © 2021-present
// Shigma).
//
// # What it is
//
// The paper models an effect as an element of `𝔈_Γ := Γ → Γ × (Γ → Γ)` (Definition 8):
// applied to the world, it yields the changed world **together with its own inverse**. The inverse
// comes back from the application rather than being supplied alongside it, and §3.1.2 is explicit
// about why:
//
//	"A per-state inverse cannot be fixed in the argument position before the state is seen; it has
//	 to be returned at the point of application."
//
// So `Setup` returns `Dispose`. An API taking `(apply, revert)` as two arguments would be the
// weaker `track(f, g)` model the paper discards on page 12.
//
// A Scope is the paper's effect context `∂Γ := Γ × (Γ → Γ)` (Definition 2): the world plus
// an **accumulator** φ, "the composite of the inverses of the effects performed so far, and the
// function that recovers the context to its initial state". Unload is `recover` (Definition 6), and
// the property it must have is the soundness invariant of Theorem 7: **φ(γ) = γ₀**.
//
// # Why it does not live in registry
//
// `registry.Fiber` borrows Cordis's word for a different thing — a static registration interface
// with no lifecycle. This package owns the mechanism and knows nothing about blocks, seams or
// postgres, the same separation Cordis keeps between `fiber.ts` and its plugins.
//
// # Status
//
// **Contract only. Every method panics.** The 128 properties in this package are stated first, so
// the port has something to be measured against instead of being declared done. They live behind
// the `effectcontract` build tag and run with `make effect-contract`; `make backend-test` does not
// include them, because a contract nobody has implemented yet is not a regression. `make lint`
// type-checks them with the tag on every run, so they cannot drift behind it.
//
// (Distinct from the red-by-design specs in `docs/design/plugin/tests.md` §1, which are red
// because the *product rule* they encode is being replaced. These are red because nothing is
// written yet.)
//
// Design: `docs/design/plugin/effects.md`.
package effect

import (
	"errors"
	"sync"
)

// ErrInactive —— an effect was registered on a Scope that is unloading or unloaded.
//
// Cordis raises `INACTIVE_EFFECT` from `assertActive()` for the same reason: an effect registered
// after the accumulator has been run is an effect nothing will ever revert. Refusing loudly is the
// only option that keeps Theorem 7 true.
var ErrInactive = errors.New("effect: scope is no longer active")

// ErrNoInverse —— a Setup returned a nil Dispose.
//
// Definition 8 gives every effect function an inverse; one that yields none is not an effect
// function, and accepting it would put an untrackable transformation inside a Scope that promises
// to be revertible.
var ErrNoInverse = errors.New("effect: setup returned no inverse")

// Dispose —— the inverse of one transformation: `g : Γ → Γ` with `g(f(γ)) = γ`.
type Dispose func() error

// Setup —— one element of 𝔈_Γ: apply a transformation and hand back its inverse.
type Setup func() (Dispose, error)

// Scope —— one component's effect context. Definition 28 makes it the **unified** context
//
//	Γ∞ := μΓ. Γ × (Γ → Γ) × Σ
//
// carrying three projections: the state, the accumulator φ, and the coeffect table Σ. The type is
// recursive on purpose — "making this structure recursive and combining it with the coeffect
// context yields Γ∞… **effect maps 𝔈_Γ∞ to itself, unifying the ∂-tower into a single
// self-similar type**".
//
// That is why there is no `lift` anywhere in this package and no `∂²Γ`: the tower the
// construction climbs collapses once the context is recursive, so what an implementation needs is
// not lifting but **nesting** —
//
//	"Components at different levels of the hierarchy are independently loadable and unloadable; a
//	 parent context aggregates and manages the effects of all its children, enabling arbitrarily
//	 nested composition."
//
// The zero value is an empty, active, parentless Scope: the initial effect context `(γ₀, id)`.
//
// **Σ belongs here, not beside it.** Def 28: "Σ subsumes all shared mutable states, not just
// inter-component dependencies. **Every interaction between a component and its environment passes
// through this single entity.**" Two entities would be two doors, and the discipline is that there
// is only one.
type Scope struct {
	once  sync.Once
	inner *state
}

// Coeffects —— this scope's Σ projection. Derived from the parent's, so a child sees what its
// parent bound unless it isolates the key itself (Def 24).

// Child —— derive a nested scope. Its effects are its own to revert, and the parent's Unload
// aggregates it: a child can be unloaded alone, and unloading the parent unloads it too.
//
// This is the whole of what the ∂-tower buys, spelled as a tree instead of a type index.

// Effect applies setup and pushes its inverse onto the accumulator, **returning a handle that
// reverts this one effect alone**.
//
// On a setup error, whatever the setup already registered **within this call** is reverted before
// the error is returned, so a half-applied effect leaves no residue (Cordis: `catch { dispose();
// throw }`).
//
// # Why it hands back a disposer instead of only an error
//
// Cordis's `ctx.effect()` does, and Theorem 15 is the reason it is safe to. Lifting an effect to
// the enclosing context (Definition 12) yields an inverse `g'` with
//
//	g'(Δ) = (γ, φ ∘ g ∘ f)
//
// — "the state is recovered exactly", and though the accumulator is *not* literally restored (it
// has grown by `g ∘ f` rather than shrunk), `(φ ∘ g ∘ f)(γ) = φ(γ)` in every case, "so
// the soundness invariant is preserved".
//
// The practical content: **an effect may be reverted early, out of order, and the scope's remaining
// recovery is still exactly right.** Calling this handle and then `Unload` lands at γ₀, and so
// does calling `Unload` alone. Without the handle a component that wants to withdraw one
// registration has to unload everything, which is why an API returning only `error` forces the very
// all-or-nothing teardown this package exists to avoid.
//
// Calling the returned Dispose twice is a no-op, and calling it after `Unload` is a no-op: the
// accumulator has already run it.

// Unload is `recover` (Definition 6): run the accumulated inverses and reset φ to the identity.
//
// Inverses run **newest first**, which Definition 9 forces rather than merely suggesting: composing
// effects accumulates `s ∘ t`, and `s ∘ t` applies `t` — the later inverse — first.
//
// Every disposer runs even if an earlier one fails; the failures come back joined. Aborting on the
// first error would strand every effect registered before it, turning one stuck inverse into a
// permanent leak of everything underneath.
//
// Calling Unload twice is a no-op: the accumulator is taken and cleared in one step, the way
// Cordis's `splice(0).reverse()` is both the ordering and the double-dispose guard.

// Active reports whether Effect would be accepted.

// Epoch is the identity of the providers this Scope is bound to — Cordis's `epoch`, the
// concatenated uids of the bound implementations, empty when any is missing.
//
// Identity, not presence: a provider **swapped** for a different one of the same name changes the
// epoch, and that is the case a presence check misses. Cordis reloads the fiber on the change.

// Bind sets the provider identities this Scope depends on, and reports whether the epoch moved.

// Slot —— a key whose value is a single binding rather than a table of entries.
//
// Definition 44 divides keys by whether their operations commute. A table where each registration
// takes an entry of its own (routes, event listeners, the block registry) is commutative, and
// Theorem 43 then lets its effects be reverted in any order. A single slot is not: two claims on
// one slot do not commute, and §3.4.2 says the order of a non-commutative key "has to be imposed
// from outside the effects".
//
// This codebase already imposes it in the strongest available way — `plugin.NewResolver` refuses
// two suppliers of one seam at load. Slot states that rule as the law it implements, so a future
// second claimant is a refusal rather than a race.
type Slot struct {
	mu    sync.Mutex
	owner string
	held  bool
}

// Claim takes the slot for owner, or fails if it is already held.
func (s *Slot) Claim(owner string) (Dispose, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.held {
		return nil, ErrSlotTaken
	}
	s.held, s.owner = true, owner
	return func() error {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.owner == owner {
			s.held, s.owner = false, ""
		}
		return nil
	}, nil
}

// ErrSlotTaken —— a second claim on a single-binding key.
var ErrSlotTaken = errors.New("effect: slot already claimed")
