// theorem7_test.go —— the **proof** of Theorem 7, read as a test suite. Red by design.
//
// Theorem 7 is the one the whole package exists for, so it is worth testing the way it is proved
// rather than only the way it is stated. The proof is four equalities:
//
//	recover(track(f,g)(γ, φ)) = recover(f(γ), φ ∘ g)        ← (1) track's definition
//	                          = (φ(g(f(γ))), id)            ← (2) recover's definition
//	                          = (φ(γ), id)                  ← (3) THE HYPOTHESIS g(f(γ)) = γ
//	                          = recover(γ, φ)               ← (4) recover's definition
//
// Each line is a separate claim an implementation can get wrong on its own, and **only line (3)
// uses the hypothesis**. That is what makes this worth splitting up: a suite that asserts the
// theorem once tells you it broke, and a suite shaped like the proof tells you *which equality*
// broke, which is the difference between a bug report and a debugging session.
//
// Two supporting results get the same treatment, because the proof leans on them:
//
//   - **Theorem 4** — `pr1 ∘ track(f,g) = f ∘ pr1`: tracking leaves the forward behaviour
//     untouched, "whatever candidate inverse it carries". This is why a wrong inverse is invisible
//     until unload.
//   - **Theorem 5** — track is a monoid homomorphism, and the composite is the **twisted** one:
//     `track(f₁,g₁) ∘ track(f₂,g₂) = track(f₁∘f₂, g₂∘g₁)`. LIFO is derived
//     here; it is not a convention anyone chose.

package effect_test

import (
	"maps"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── Theorem 4 — the forward behaviour is the same whatever inverse is carried ──────────────────
//
// "On the context state, track(f,g) acts as f does, whatever candidate inverse it carries."
//
// The most useful sentence in §3.1 for anyone debugging, because it says the failure mode
// outright: an effect with a wrong inverse behaves **perfectly** while it is loaded. Nothing is
// observable until recovery, so the bug is planted at install and detonates at uninstall, usually
// in a different session and often on a different machine.

func TestAWrongInverseIsInvisibleUntilRecovery(t *testing.T) {
	t.Parallel()
	w := newWorld()

	// f writes alpha; g "reverts" it by writing the wrong value. The pair is not an inverse pair.
	var s effect.Scope
	mustEffect(t, &s, "wrong-inverse", func() (effect.Dispose, error) {
		w[keyAlpha] = valOne
		return func() error { w[keyAlpha] = "WRONG"; return nil }, nil
	})

	require.Equal(t, valOne, w[keyAlpha],
		"Thm 4: pr1 ∘ track(f,g) = f ∘ pr1. The forward state is exactly what f produced, and "+
			"the "+
			"bad inverse has left no trace of itself. This is why 'it works' is not evidence of "+
			"anything here")

	require.NoError(t, s.Unload())
	require.Equal(t, "WRONG", w[keyAlpha],
		"and the whole error surfaces at recovery, in one step, having been latent since install")
}

// ── Theorem 5.1 — the unit is carried to the unit ──────────────────────────────────────────────
//
//	track(id, id)(γ, φ) = (γ, φ ∘ id) = (γ, φ)
//
// An effect that does nothing must leave the accumulator alone as well as the state. An
// implementation that pushes a no-op disposer onto φ satisfies the state half and fails this one,
// and the symptom appears much later as an accumulator whose length is not the number of effects.

func TestAnEffectThatChangesNothingLeavesTheAccumulatorAlone(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)

	var s effect.Scope
	mustEffect(t, &s, "noop", func() (effect.Dispose, error) {
		return func() error { return nil }, nil
	})
	mustEffect(t, &s, "real", set(w, keyAlpha, valOne))
	mustEffect(t, &s, "noop2", func() (effect.Dispose, error) {
		return func() error { return nil }, nil
	})

	require.NoError(t, s.Unload())
	require.True(t, sameUnder(before, w, []string{keyAlpha, "seeded"}),
		"track(id,id) = id_∂Γ: the identity is carried to the identity, so interleaving no-ops "+
			"changes neither the state nor the recovery")
}

// ── Theorem 5.2 — the composite is the TWISTED composite, and that is where LIFO comes from
// ────
//
//	track(f₁,g₁) ∘ track(f₂,g₂) = track(f₁ ∘ f₂, g₂ ∘ g₁)
//
// Forward maps compose in application order; inverses compose in the **opposite** order. Nobody
// decided this. It falls out of `track` post-composing onto φ — `(γ, φ) ↦ (f(γ), φ ∘ g)`
// — so the later inverse ends up leftmost and therefore runs first.
//
// The test is a shared cell rather than distinct keys, because distinct keys commute (Thm 45) and
// would pass under either order. A non-commutative location is the only place the twist is visible.

func TestTheInversesComposeInTheOppositeOrderToTheForwardMaps(t *testing.T) {
	t.Parallel()
	w := newWorld()
	var undone []string

	// Both effects write the SAME cell, so the order of restoration is observable.
	push := func(label, v string) effect.Setup {
		return func() (effect.Dispose, error) {
			old, had := w["stack"]
			w["stack"] = v
			return func() error {
				undone = append(undone, label)
				if had {
					w["stack"] = old
				} else {
					delete(w, "stack")
				}
				return nil
			}, nil
		}
	}

	var s effect.Scope
	mustEffect(t, &s, "f1", push("g1", "first"))
	mustEffect(t, &s, "f2", push("g2", "second"))
	require.NoError(t, s.Unload())

	require.Equal(t, []string{"g2", "g1"}, undone,
		"the twist: φ ∘ g₁ ∘ g₂ applied to a state runs g₂ first. LIFO is a CONSEQUENCE "+
			"of the "+
			"monoid homomorphism, not a convention — an implementation that appends inverses and "+
			"replays them forward has not made a stylistic choice, it has broken Theorem 5")
	require.NotContains(t, w, "stack",
		"and the twist is what makes the round trip land: the wrong order restores `first` and "+
			"leaves it there")
}

// ── proof line (1) — track post-composes onto φ; it does not pre-compose ───────────────────────
//
// Stated separately from the test above because they fail on different code. The order test above
// catches `φ ∘ g` written as `g ∘ φ`; this one catches an accumulator that is **replaced**
// rather than extended, which reverts only the last effect and passes every single-effect test.

func TestTheAccumulatorIsExtendedByEachEffectNotReplaced(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)

	var s effect.Scope
	mustEffect(t, &s, "a", set(w, keyAlpha, valOne))
	mustEffect(t, &s, "b", set(w, "beta", valTwo))
	mustEffect(t, &s, "c", set(w, "gamma", valThree))
	require.NoError(t, s.Unload())

	require.True(t, sameUnder(before, w, []string{keyAlpha, "beta", "gamma", "seeded"}),
		"track is (γ, φ) ↦ (f(γ), φ ∘ g): φ is EXTENDED. An implementation holding the "+
			"last "+
			"inverse rather than their composite reverts `gamma` and leaves `alpha` and `beta` "+
			"behind — and passes every test that registers only one effect")
}

// ── proof line (2) — recover applies φ AND resets it to the identity ───────────────────────────
//
//	recover = (γ, φ) ↦ (φ(γ), id)
//
// Both halves are load-bearing. The reset is what makes recovery idempotent: without it, a second
// recover applies φ to an already-recovered state, which for a non-idempotent inverse is a second
// deletion of something that has already gone.

func TestRecoveryResetsTheAccumulatorSoASecondRecoveryIsTheIdentity(t *testing.T) {
	t.Parallel()
	w := newWorld()
	runs := 0

	var s effect.Scope
	mustEffect(t, &s, "counted", func() (effect.Dispose, error) {
		w[keyAlpha] = valOne
		return func() error { runs++; delete(w, keyAlpha); return nil }, nil
	})

	require.NoError(t, s.Unload())
	require.Equal(t, 1, runs)
	require.NoError(t, s.Unload())
	require.Equal(t, 1, runs,
		"recover resets φ to id_Γ, so recovering twice is recovering once. Without the reset the "+
			"inverse runs again against a state it has already been applied to — which for `DROP "+
			"SCHEMA` or `free` is not a no-op")
}

// ── proof line (3) — the ONE place the hypothesis g(f(γ)) = γ is used ──────────────────────────
//
// Every other equality in the proof is definitional. This one is the theorem's price: an effect
// whose inverse does not revert it moves the result of recovery, and Theorem 7 says nothing about
// it.
//
// Worth its own test because it is the boundary of what the package guarantees, and the guarantee
// is routinely mistaken for something stronger — "unload runs the disposers" is true of a wrong
// inverse too.

func TestRecoveryMovesExactlyWhenAnInverseFailsToRevertItsOwnStep(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)
	keys := []string{keyAlpha, "seeded"}

	// The hypothesis holds: g(f(γ)) = γ.
	var good effect.Scope
	mustEffect(t, &good, "faithful", set(w, keyAlpha, valOne))
	require.NoError(t, good.Unload())
	require.True(t, sameUnder(before, w, keys), "φ(γ) = γ₀ preserved")

	// The hypothesis fails: g(f(γ)) ≠ γ. Nothing in the API distinguishes this at registration.
	var bad effect.Scope
	mustEffect(t, &bad, "unfaithful", func() (effect.Dispose, error) {
		w[keyAlpha] = valOne
		return func() error { w[keyAlpha] = "leftover"; return nil }, nil
	})
	require.NoError(t, bad.Unload())
	require.False(t, sameUnder(before, w, keys),
		"the soundness invariant φ(γ) = γ₀ is a HYPOTHESIS on each pair, not something the "+
			"mechanism can enforce. Every effect registered here carries an obligation the type "+
			"system cannot check, and this is the only line of the proof where it is spent")
}

// ── the theorem as stated — recovery is invariant under taking more tracked steps ──────────────
//
// "Each tracking step in fact preserves the result of recovery itself, FROM WHATEVER STATE IT IS
// TAKEN: recovering after the step returns what recovering before it would have."
//
// That is stronger than "unload restores γ₀", and it is the form the product actually needs: the
// state a block would be uninstalled to does not depend on how much the block has done since.

func TestRecoveringAfterMoreWorkLandsWhereRecoveringBeforeItWouldHave(t *testing.T) {
	t.Parallel()
	keys := []string{keyAlpha, "beta", "gamma", "seeded"}

	// Recover early.
	early := newWorld()
	var a effect.Scope
	mustEffect(t, &a, "a", set(early, keyAlpha, valOne))
	require.NoError(t, a.Unload())

	// Do considerably more, then recover.
	late := newWorld()
	var b effect.Scope
	mustEffect(t, &b, "a", set(late, keyAlpha, valOne))
	mustEffect(t, &b, "b", set(late, "beta", valTwo))
	mustEffect(t, &b, "c", set(late, "gamma", valThree))
	mustEffect(t, &b, "d", set(late, keyAlpha, "overwritten"))
	require.NoError(t, b.Unload())

	require.True(t, sameUnder(early, late, keys),
		"equation (10): recover(track(f,g)(γ,φ)) = recover(γ,φ). The recovery point is fixed "+
			"at "+
			"the moment the scope opened and cannot be dragged by later work — including work "+
			"that overwrites an earlier effect's own key")
}

// ── equation (11) — the sequence case, which is ONE application of the theorem ─────────────────
//
// "The preservation along a sequence follows from Theorem 5 in one application": the composite is a
// single tracking step of the twisted composite, that composite's inverse carries δₙ back to
// δ₀, so the hypothesis is met at γ and the theorem applies once.
//
// The consequence worth testing is that the invariant holds at **every** intermediate state, so the
// sequence may be cut anywhere.

func TestTheInvariantHoldsAtEveryIntermediateStateOfASequence(t *testing.T) {
	t.Parallel()
	before := maps.Clone(newWorld())
	keys := []string{keyAlpha, "beta", "gamma", "seeded"}

	for cut := range 3 + 1 {
		w := newWorld()
		var s effect.Scope
		steps := []effect.Setup{
			set(w, keyAlpha, valOne), set(w, "beta", valTwo), set(w, "gamma", valThree),
		}
		for i := range cut {
			mustEffect(t, &s, "step", steps[i])
		}
		require.NoError(t, s.Unload())
		require.True(t, sameUnder(before, w, keys),
			"cut after %d step(s): φ(γ) = γ₀ at δ_%d, so the sequence is interruptible "+
				"there", cut, cut)
	}
}

// ── the last line of §3.1.1 — a global inverse is a different and weaker thing ─────────────────
//
// "A pair with g ∘ f = id_Γ meets the hypothesis at every state."
//
// *At every state* is the distinction, and it is exactly why Definition 8 returns the inverse from
// the application. A global inverse like "delete the key" satisfies `g(f(γ)) = γ` at states where
// the key was absent, and fails at every state where it was not — so it passes on an empty
// fixture and fails in production, which is the worst arrangement available.

func TestAGlobalInverseMeetsTheHypothesisOnlyAtSomeStates(t *testing.T) {
	t.Parallel()

	// The tempting global inverse: whatever was written, delete it.
	globalInverse := func(w world, k, v string) effect.Setup {
		return func() (effect.Dispose, error) {
			w[k] = v
			return func() error { delete(w, k); return nil }, nil
		}
	}

	// At a state where the key is absent, it is a correct inverse.
	fresh := newWorld()
	beforeFresh := maps.Clone(fresh)
	var a effect.Scope
	mustEffect(t, &a, "global", globalInverse(fresh, keyAlpha, valOne))
	require.NoError(t, a.Unload())
	require.True(t, sameUnder(beforeFresh, fresh, []string{keyAlpha, "seeded"}),
		"g ∘ f = id holds here, so the pair meets the hypothesis at THIS state")

	// At a state where it is present, the same inverse destroys a value it never wrote.
	occupied := newWorld()
	occupied[keyAlpha] = "someone-elses"
	beforeOccupied := maps.Clone(occupied)
	var b effect.Scope
	mustEffect(t, &b, "global", globalInverse(occupied, keyAlpha, valOne))
	require.NoError(t, b.Unload())
	require.False(t, sameUnder(beforeOccupied, occupied, []string{keyAlpha, "seeded"}),
		"and fails here. §3.1.2: 'a per-state inverse cannot be fixed in the argument position "+
			"before the state is seen; it has to be returned at the point of application.' That "+
			"sentence is the whole reason Setup returns Dispose, and this is the bug it prevents")

	// The per-state inverse, which is what `set` builds, is correct at both.
	correct := newWorld()
	correct[keyAlpha] = "someone-elses"
	beforeCorrect := maps.Clone(correct)
	var c effect.Scope
	mustEffect(t, &c, "per-state", set(correct, keyAlpha, valOne))
	require.NoError(t, c.Unload())
	require.True(t, sameUnder(beforeCorrect, correct, []string{keyAlpha, "seeded"}),
		"the inverse knew there HAD been a value, and could only know it because it was built "+
			"after the state was seen")
}
