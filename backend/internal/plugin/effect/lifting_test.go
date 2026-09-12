// lifting_test.go —— §3.1.2: **Theorems 10, 11, 13, 14 and 15**, the results about
// `effect_Γ`, which lifts an effect function to the enclosing context. Red by design.
//
// These are the algebraic backbone, and they are the ones most likely to be skipped on the grounds
// that "the monoid laws are obviously satisfied". They are not obviously satisfied by an
// implementation that keeps a slice of disposers: associativity holds, the unit law usually holds,
// and **Theorem 11's closure** — that composing two witnessed effects yields a witnessed effect
// — is exactly what fails when a partial failure is handled by dropping one entry.
//
// Theorem 15 is the sharp one, and the reason `Scope.Effect` returns a handle:
//
//	g'(Δ) = (γ, φ ∘ g ∘ f)
//
// "The state is recovered exactly. The accumulator is restored as well… **if and only if g ∘ f
// = id**; and in every case (φ ∘ g ∘ f)(γ) = φ(γ), so the soundness invariant is
// preserved."
//
// In product terms: **one effect may be withdrawn early, and the rest of the scope still unloads
// correctly.** Reverting is itself an effect, and it composes onto the accumulator rather than
// being popped off it.

package effect_test

import (
	"errors"
	"maps"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── Theorem 10.1 — (𝔈_Γ, ⋄) is a monoid: the unit is η_Γ = γ ↦ (γ, id) ─────────────────────────
//
// The unit law has observable content: an effect that yields the identity inverse must leave the
// accumulator where it found it. An implementation that unconditionally appends satisfies the state
// half and grows φ by a no-op for every such effect — harmless until a component registers
// thousands of them and every reload walks the lot.

func TestTheUnitEffectIsNeutralOnBothSides(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)
	var ran []string

	unit := func() (effect.Dispose, error) {
		return func() error { ran = append(ran, "unit"); return nil }, nil
	}
	apply := func(k string) effect.Setup {
		return func() (effect.Dispose, error) {
			w[k] = "1"
			return func() error { ran = append(ran, k); delete(w, k); return nil }, nil
		}
	}

	// unit ⋄ f ⋄ unit must behave as f.
	var s effect.Scope
	mustEffect(t, &s, "left-unit", unit)
	mustEffect(t, &s, "f", apply(keyAlpha))
	mustEffect(t, &s, "right-unit", unit)
	require.NoError(t, s.Unload())

	require.True(t, sameUnder(before, w, []string{keyAlpha, "seeded"}))
	require.Equal(t, []string{"unit", keyAlpha, "unit"}, ran,
		"η_Γ is a two-sided unit for ⋄: bracketing an effect with units changes neither the "+
			"state "+
			"reached nor the order the rest is reverted in")
}

func TestEffectCompositionIsAssociative(t *testing.T) {
	t.Parallel()
	keys := []string{keyA, keyB, keyC, "seeded"}

	// (f ⋄ g) ⋄ h and f ⋄ (g ⋄ h) differ only in how the sequence is grouped into child
	// scopes. Theorem 10.1 says grouping is invisible.
	left := newWorld()
	var ls effect.Scope
	inner := ls.Child("f-then-g")
	mustEffect(t, inner, "f", set(left, keyA, valOne))
	mustEffect(t, inner, "g", set(left, keyB, valTwo))
	mustEffect(t, &ls, "h", set(left, keyC, valThree))

	right := newWorld()
	var rs effect.Scope
	mustEffect(t, &rs, "f", set(right, keyA, valOne))
	inner2 := rs.Child("g-then-h")
	mustEffect(t, inner2, "g", set(right, keyB, valTwo))
	mustEffect(t, inner2, "h", set(right, keyC, valThree))

	require.True(t, sameUnder(left, right, keys), "the two groupings reach the same state")
	require.NoError(t, ls.Unload())
	require.NoError(t, rs.Unload())
	require.True(t, sameUnder(left, right, keys),
		"…and recover to the same one. Associativity of ⋄ is what makes a component free to "+
			"split "+
			"its loading into sub-scopes wherever it likes")
}

// ── Theorem 11.1 — 𝔈*_Γ is a SUBMONOID: composing witnessed effects yields a witnessed
// effect ──
//
//	let (δ,s) = g(γ), (ε,t) = f(δ); then (s ∘ t)(ε) = s(δ) = γ
//
// The closure property, and the one a partial-failure path breaks. If a composite ever drops one
// constituent's inverse — because its setup failed, because it was deduplicated, because it
// looked like a no-op — the composite is no longer in 𝔈*, and nothing downstream announces
// that.

func TestTheCompositeOfWitnessedEffectsIsItselfWitnessed(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)
	keys := []string{keyA, keyB, keyC, "seeded"}

	// Three witnessed effects, composed by a child scope, which is then composed into its parent.
	var outer effect.Scope
	mid := outer.Child("composite")
	mustEffect(t, mid, "g", set(w, keyA, valOne))
	mustEffect(t, mid, "f", set(w, keyB, valTwo))
	mustEffect(t, &outer, "h", set(w, keyC, valThree))

	require.NoError(t, outer.Unload())
	require.True(t, sameUnder(before, w, keys),
		"closure under ⋄: the composite's inverse is s ∘ t and (s∘t)(ε) = γ. A scope whose "+
			"accumulator is missing one constituent is not in 𝔈* and will not recover, and the "+
			"only place that shows is here")
}

// ── Theorem 11.2 — a uniform inverse (g ∘ f = id) witnesses at EVERY state ─────────────────────
//
// The converse half of the global-vs-per-state test in theorem7_test.go: where `g ∘ f = id`
// really does hold everywhere, the pair is witnessed everywhere and nothing is lost by fixing the
// inverse in advance. The distinction matters because it says *when* the weaker `track(f,g)` model
// is adequate — a genuinely involutive operation, and nothing else.

// toggle —— its own inverse: g ∘ f = id at EVERY state, whatever was there. The one shape for
// which the weaker track(f,g) model of §3.1.2 would have been adequate.
func toggle(w world, k string) effect.Setup {
	flip := func() {
		if w[k] == "on" {
			w[k] = "off"
			return
		}
		w[k] = "on"
	}
	return func() (effect.Dispose, error) {
		flip()
		return func() error { flip(); return nil }, nil
	}
}

func TestAUniformInverseIsWitnessedAtEveryState(t *testing.T) {
	t.Parallel()

	for _, start := range []string{"on", "off"} {
		w := newWorld()
		w["switch"] = start
		before := maps.Clone(w)

		var s effect.Scope
		mustEffect(t, &s, "toggle", toggle(w, "switch"))
		require.NoError(t, s.Unload())
		require.True(t, sameUnder(before, w, []string{"switch", "seeded"}),
			"starting at %q: g ∘ f = id_Γ, so the pair meets Theorem 7's hypothesis at every "+
				"state and the inverse could safely have been fixed in advance", start)
	}
}

// ── Theorem 13 / 14 — lifting preserves composition and leaves forward behaviour alone ────────
//
//	effect(f) ⋄ effect(g) = effect(f ⋄ g)          (Thm 13)
//	pr1 ∘ f' = f ∘ pr1                             (Thm 14.1)
//
// Read onto the nesting: a child scope's effects, seen from the parent, behave exactly as if they
// had been registered on the parent directly. That is the property that makes sub-scopes a free
// organisational device rather than a semantic choice.

func TestAChildScopesEffectsBehaveAsIfRegisteredOnTheParent(t *testing.T) {
	t.Parallel()
	keys := []string{keyA, keyB, "seeded"}

	nested := newWorld()
	var p effect.Scope
	c := p.Child("nested")
	mustEffect(t, c, "a", set(nested, keyA, valOne))
	mustEffect(t, c, "b", set(nested, keyB, valTwo))

	flat := newWorld()
	var f effect.Scope
	mustEffect(t, &f, "a", set(flat, keyA, valOne))
	mustEffect(t, &f, "b", set(flat, keyB, valTwo))

	require.True(t, sameUnder(nested, flat, keys),
		"Thm 14.1: lifting does not touch the forward map")
	require.NoError(t, p.Unload())
	require.NoError(t, f.Unload())
	require.True(t, sameUnder(nested, flat, keys),
		"Thm 13: effect(f) ⋄ effect(g) = effect(f ⋄ g) — the lift is a homomorphism, so the "+
			"recovery agrees too")
}

// ── Theorem 15 — an effect may be reverted EARLY, and the rest still recovers exactly ─────────
//
// The whole reason `Effect` returns a handle. Reverting is itself an effect: `g'` composes `g ∘
// f` onto the accumulator rather than removing anything from it, and `(φ ∘ g ∘ f)(γ) =
// φ(γ)` keeps the invariant. An implementation that instead *pops* the disposer out of the stack
// will pass the state half of this test and fail it the moment two effects touch one key.

func TestAnEffectRevertedEarlyLeavesTheRemainingRecoveryExact(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)
	keys := []string{keyA, keyB, keyC, "seeded"}

	var s effect.Scope
	mustEffect(t, &s, "a", set(w, keyA, valOne))
	undoB, err := s.Effect("b", set(w, keyB, valTwo))
	require.NoError(t, err)
	mustEffect(t, &s, "c", set(w, keyC, valThree))

	require.NoError(t, undoB(), "one effect withdrawn, out of order, while the scope stays active")
	require.NotContains(t, w, keyB)
	require.Equal(t, "1", w[keyA], "and its neighbours are untouched")
	require.Equal(t, "3", w[keyC])
	require.True(t, s.Active())

	require.NoError(t, s.Unload())
	require.True(t, sameUnder(before, w, keys),
		"Thm 15: 'the state is recovered exactly… and in every case (φ ∘ g ∘ f)(γ) = "+
			"φ(γ), so the "+
			"soundness invariant is preserved'. The accumulator did not shrink — it grew by a "+
			"map "+
			"that is the identity where it matters")
}

func TestRevertingTheSameEffectTwiceIsANoOp(t *testing.T) {
	t.Parallel()
	runs := 0

	var s effect.Scope
	undo, err := s.Effect("counted", func() (effect.Dispose, error) {
		return func() error { runs++; return nil }, nil
	})
	require.NoError(t, err)

	require.NoError(t, undo())
	require.NoError(t, undo())
	require.Equal(t, 1, runs, "the handle is idempotent")

	require.NoError(t, s.Unload())
	require.Equal(t, 1, runs,
		"and the accumulator does not run it again: an inverse already applied must not be "+
			"applied a second time by the scope that held it — `DROP SCHEMA` twice is an error, "+
			"not a no-op")
}

// ── the closing sentence of §3.1.2 — effect_Γ does NOT carry 𝔈* into 𝔈*_∂Γ ────────────────────
//
// "The lower triangle therefore closes only when the inverse witnessed at γ reverts f at every
// state, so effect_Γ does not carry 𝔈*_Γ into 𝔈*_∂Γ. What holds in every case is
// agreement at γ."
//
// A limit on the guarantee, stated as such: lifting is not unconditionally structure-preserving,
// and what survives the lift is precisely Theorem 7's assumption and nothing more. Worth a test
// because the natural mistake is to assume the stronger closure and then rely on it somewhere.

func TestAPerStateInverseRecoversTheParentThoughTheLiftIsNotClosed(t *testing.T) {
	t.Parallel()
	w := newWorld()
	w["shared"] = "original"
	before := maps.Clone(w)

	// A per-state inverse: correct at the state it saw, not a uniform one. g ∘ f ≠ id in
	// general, so effect_Γ(e) ∉ 𝔈*_∂Γ — and recovery is still exact.
	var parent effect.Scope
	child := parent.Child("per-state")
	mustEffect(t, child, "overwrite", set(w, "shared", "changed-by-child"))
	mustEffect(t, &parent, "other", set(w, "other", valOne))

	require.NoError(t, parent.Unload())
	require.True(t, sameUnder(before, w, []string{"shared", "other", "seeded"}),
		"agreement at γ is all the theorem gives, and all the product needs: the recovery target "+
			"is untouched even where the lift fails to be closed")
}

// ── a failing inverse inside a composite does not break the rest of the composite ──────────────

func TestAFailingInverseInsideAChildIsReportedWithoutStrandingTheParent(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)
	stuck := errors.New("this inverse is stuck")

	var parent effect.Scope
	child := parent.Child("composite")
	mustEffect(t, child, "good", set(w, keyA, valOne))
	mustEffect(t, child, "stuck", func() (effect.Dispose, error) {
		return func() error { return stuck }, nil
	})
	mustEffect(t, &parent, "outer", set(w, keyB, valTwo))

	err := parent.Unload()
	require.ErrorIs(t, err, stuck, "the failure is reported, not swallowed")
	require.True(t, sameUnder(before, w, []string{keyA, keyB, "seeded"}),
		"and every other inverse ran: aborting at the first failure would strand the parent's own "+
			"effects behind a child's stuck disposer, turning one bad inverse into a total leak")
}
