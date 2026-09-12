// iterator.go —— §3.1.3: effect iterators. Definition 17/18, Theorem 16.
//
// **Contract only. Every method panics.** Design: `docs/design/plugin/effects.md`.
//
// # What an iterator is for
//
//	"What a component loads by is not one effect but A SEQUENCE of them, and what its unloading
//	 reverts is the whole sequence."
//
// Mounting a block is already such a sequence here: provision its storage, start its sandbox,
// register its tools, publish what it provides. Today that sequence is a function with cleanup
// wired in by hand at each early return — which is the arrangement where the fourth step's
// failure forgets the second step's undo, and nothing in the type says it should not.
//
// Definition 17 reifies the sequence:
//
//	𝔍_Γ := μ𝔍. Γ → Γ × (Γ → Γ) × Maybe(𝔍)
//
// each iteration yielding the new context, **the inverse of that step**, and a continuation:
// `Nothing` terminates, `Just(i)` is the next step.
//
// # The two things that buys, which a plain function does not
//
// **A boundary between any two steps.** "The Maybe(𝔍) continuation makes a boundary available
// between any two consecutive iterations, at which the context is whatever the iterations so far
// have made it and the accumulator recovers those AND NOTHING MORE. In this sense the effect
// iterator is a reified delimited continuation" — the structure `yield` exposes in other
// languages.
//
// So a load can stop between steps and the unload at that point is exactly right. That is the
// property a partially-mounted block needs, and it is why this is not the same as "a slice of
// cleanup functions": a slice has no notion of where the sequence got to.
//
// **An iterator is itself an effect** (Def 18 lands in the same `∂Γ → ∂²Γ` as `effect`
// does), "and can be used wherever an effect can, and Section 4 reads a component's whole loading
// as one iterator." So nesting is free: a step of one load may itself be a whole load.
//
// A plain effect is the degenerate case — equation (19): the iterator whose first step already
// yields `Nothing`.

package effect

// Step —— one iteration of Definition 17: apply this step, hand back its inverse, and say
// whether another step follows.
//
// `more == nil` is `Nothing` (the sequence is finished); a non-nil `more` is `Just(i)`.
//
// The inverse is per-step and returned at the point of application, for the same reason `Setup`
// works that way (Def 8): the state a step's inverse must restore is the one that step saw.
type Step func() (undo Dispose, more Step, err error)

// Iterator —— `𝔍_Γ`. A component's whole loading, as one value.

// Sequence builds an Iterator from the first Step.

// Once —— equation (19): a plain effect embedded as the iterator whose first iteration already
// yields Nothing. Present so that `Effect` and `Run` are not two parallel worlds; the embedding
// "carries 𝔈* into 𝔍*, the two witnesses asking the same equation".

// Run —— Definition 18: drive the iterator, composing each step's inverse onto the accumulator
// **in application order**, so that `φ ∘ g₁ ∘ … ∘ gₖ` reverts in LIFO when applied
// (Theorem 16).
//
// A step returning an error stops the sequence, and the steps already taken are reverted before Run
// returns — the same rule a failing `Setup` obeys, one level up. The alternative, leaving a
// half-loaded component in place, is the state this whole file exists to make unrepresentable.

// Advance —— take exactly one step, and report whether another remains.
//
// Exists because the boundary is the point: a caller that wants to stop between steps (a load
// interrupted, a step waiting on a coeffect that is not yet satisfied) needs to be able to, and
// `Unload` at that moment must revert precisely the steps taken. A `Run` that could only go to
// completion would make the boundary unobservable and Definition 17's `Maybe` decorative.
