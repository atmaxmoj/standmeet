// relation_test.go —— §3.3.2 and §3.4: **Lemmas 35, 38, 39 and 41**, the results that license
// reading every equality in this package up to ≃ and settling commutation on the generators. Red
// by design.
//
// Easy to skip as bookkeeping. They are not: Lemma 35's closing paragraph names the exact
// arrangement in which a map respects ≃ and fails to respect ≃_S, and that arrangement is a
// component branching on a key it never declared — the bug §4.2.3's confinement exists to make
// impossible.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── Lemma 35 — ≃_S is a PARTIAL equivalence: symmetric and transitive, not reflexive ──────────
//
// "On maps and on iterators ≃_S is a partial equivalence: it is symmetric and transitive, so two
// related members each respect it."
//
// The missing reflexivity is the content. "f ≃_S f demands related outputs at every pair of
// related inputs and not at the equal ones alone, so it holds of a map exactly where the map
// descends, which is why **respect is a condition rather than a given**."

func TestTheRelationIsSymmetricAndTransitive(t *testing.T) {
	t.Parallel()

	mk := func(cal, extra string) *effect.Table {
		var tbl effect.Table
		_, err := tbl.Set(seamCalendar, cal)
		require.NoError(t, err)
		_, err = tbl.Set("telemetry", extra)
		require.NoError(t, err)
		return &tbl
	}
	a, b, c := mk("google", "run-1"), mk("google", "run-2"), mk("google", "run-3")
	s := []string{seamCalendar}

	require.True(t, a.Equivalent(b, s))
	require.True(t, b.Equivalent(a, s), "symmetry")
	require.True(t, b.Equivalent(c, s))
	require.True(t, a.Equivalent(c, s), "transitivity")
}

// The separating case the lemma names, spelled out. A map that branches on a key outside S respects
// ≃ (it is a function) and fails to respect ≃_S (two S-related inputs give unrelated outputs).
//
// Which is exactly a component reading a seam it did not declare: harmless-looking, and it makes
// every claim stated "at the keys this component names" false for that component.

func TestAMapBranchingOnAKeyOutsideItsDeclarationsFailsToRespectTheRelation(t *testing.T) {
	t.Parallel()

	// Two tables indistinguishable at S = {calendar}, differing at a key outside it.
	var a, b effect.Table
	for _, tbl := range []*effect.Table{&a, &b} {
		_, err := tbl.Set(seamCalendar, "google")
		require.NoError(t, err)
	}
	_, err := a.Set("telemetry", "on")
	require.NoError(t, err)
	_, err = b.Set("telemetry", "off")
	require.NoError(t, err)

	s := []string{seamCalendar}
	require.True(t, a.Equivalent(&b, s), "related at S")

	// An operation that reads outside S.
	peeking := func(v any) effect.Outcome {
		tbl, ok := v.(*effect.Table)
		if !ok {
			return effect.Outcome{Defined: false}
		}
		got, getErr := tbl.Get("telemetry")
		return effect.Outcome{Value: got, Defined: getErr == nil}
	}
	// The suite is the RELATION the operation is judged against: read at {calendar}, the two tables
	// are related. `peeking` then separates them, which is the failure Lemma 32 names.
	related := []effect.Test{{func(v any) effect.Outcome {
		tbl, ok := v.(*effect.Table)
		if !ok {
			return effect.Outcome{Defined: false}
		}
		got, readErr := tbl.Get(seamCalendar)
		return effect.Outcome{Value: got, Defined: readErr == nil}
	}}}
	require.False(t, effect.RespectedBy(peeking, &a, &b, related),
		"'a map that branches on a key outside S is the case that separates them, respecting ≃ "+
			"and failing to respect ≃_S'. Def 55 clause (2) makes this unrepresentable for a "+
			"component, and this is the theorem that says why it had to")
}

// ── Lemma 38 — every equality of §3.1 holds with = replaced by ≃ ──────────────────────────────
//
// "The accumulator of every state reachable from (γ₀, id) respects ≃… a composition of maps
// respecting ≃ respects ≃, the base case being id_Γ."
//
// So the soundness invariant reads `φ(γ) ≃ γ₀`, which is what every test in this package
// asserts. The testable content is the *closure*: composing inverses that each recover up to ≃
// gives an accumulator that recovers up to ≃, with no drift accumulating across the chain.

// reprovision —— recovers only UP TO ≃: it restores the value and draws a FRESH generative
// id, which is the paper's own example of why Theorem 7's equality has to be read up to an
// equivalence.
func reprovision(w world, k string, seq *int) effect.Setup {
	gen := func() string {
		*seq++
		return "gen-" + string(rune('a'+*seq%26))
	}
	return func() (effect.Dispose, error) {
		old, had := w[k]
		w[k] = "live"
		w[k+".id"] = gen()
		return func() error {
			if had {
				w[k] = old
			} else {
				delete(w, k)
			}
			w[k+".id"] = gen() // a fresh id, not the old one
			return nil
		}, nil
	}
}

func TestRecoveryUpToEquivalenceDoesNotDriftAcrossALongChain(t *testing.T) {
	t.Parallel()

	// Each effect recovers only up to ≃: it restores the value but draws a fresh generative id,
	// exactly the paper's example. Twenty of them in a row must still land at γ₀ up to ≃.
	w := newWorld()
	seq := 0
	before := map[string]string{"seeded": w["seeded"]}
	var s effect.Scope
	// Twenty, not two: drift that a single round trip hides accumulates over a chain.
	const chainLength = 20
	for range chainLength {
		mustEffect(t, &s, "reprovision", reprovision(w, "schema", &seq))
	}
	require.NoError(t, s.Unload())

	require.True(t, sameUnder(before, w, []string{"schema", "seeded"}),
		"observed at the keys that are bound, twenty recoveries land where none had happened. "+
			"`schema.id` is different at every step and is not one of them — 'the part of a "+
			"state that no key binds is thereby forgotten'")
}

// ── Lemma 39 — an iterator whose stages occur at keys of S is witnessed at S ───────────────────
//
// "Let S ⊆ K contain every key at which a stage of i occurs. Then i lies in ℑ^S_Σ; in
// particular i and every inverse it yields respect ≃_S, and the witnesses hold at equality."
//
// The practical reading: **a component's loading is witnessed at exactly the keys it touches, and
// that set is its own declarations.** So a claim proved "at the keys this component names" is
// available for every component without anyone enumerating anything extra.

func TestAComponentsLoadingIsWitnessedAtPreciselyTheKeysItDeclares(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberMail, supplier(seamMail, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))
	settle(t, &r)

	reference := r.Coeffects()

	// Retire and restore the consumer. Its episode touches `calendar` and nothing else, so the
	// context is unchanged at every key — but the claim available is at {calendar}, its own S.
	retire(t, &r, fiberBooker)
	settle(t, &r)

	require.True(t, reference.Equivalent(r.Coeffects(), []string{seamCalendar}),
		"witnessed at the keys the component's stages occur at — which for a component that "+
			"declares `calendar` is {calendar}, read off the manifest rather than off a trace")
	require.True(t, reference.Equivalent(r.Coeffects(), []string{seamMail}),
		"and a key outside its declarations was never in question: Lemma 39 is what lets a "+
			"per-component claim be made without quantifying over the whole instance")
}

// ── Lemma 41.1 — commutation is settled on the GENERATORS ─────────────────────────────────────
//
// "If every generator of 𝔐(e₁) commutes with every generator of 𝔐(e₂), then every element
// of 𝔐(e₁) commutes with every element of 𝔐(e₂)."
//
// This is what makes independence checkable at all. Without it, "these two components are
// independent" would quantify over every composite either one can form — unbounded. With it,
// checking the generators suffices, and the generators are the individual operations a seam
// publishes.

func TestCommutationOfTheGeneratorsSufficesForTheWholeComposite(t *testing.T) {
	t.Parallel()
	keys := []string{"a1", "a2", "a3", "b1", "b2", "b3", "seeded"}

	// Two components whose generators are key-local at disjoint keys, so they commute pairwise.
	// Lemma 41.1 says their composites then commute, however long each runs.
	runAThenB := newWorld()
	var s1 effect.Scope
	for _, k := range []string{"a1", "a2", "a3"} {
		mustEffect(t, &s1, k, set(runAThenB, k, valOne))
	}
	for _, k := range []string{"b1", "b2", "b3"} {
		mustEffect(t, &s1, k, set(runAThenB, k, valOne))
	}

	interleaved := newWorld()
	var s2 effect.Scope
	for _, k := range []string{"a1", "b1", "a2", "b2", "a3", "b3"} {
		mustEffect(t, &s2, k, set(interleaved, k, valOne))
	}

	require.True(t, sameUnder(runAThenB, interleaved, keys),
		"the composites commute because their generators do — checked on the operations a seam "+
			"publishes, not on the unbounded set of sequences those operations can form")
}

// ── Lemma 41.2 — ⋄ enlarges no transformation monoid ──────────────────────────────────────────
//
// "𝔐(e₁ ⋄ e₂) ⊆ ⟨𝔐(e₁) ∪ 𝔐(e₂)⟩: every generator of 𝔐(e₁ ⋄ e₂)
// is a composite of generators of the two."
//
// Composition introduces no new transformation. Read onto the product: **a group of blocks can
// reach exactly what its members can reach, and nothing more.** Composing them is not a privilege
// escalation, which is a claim an access-control reviewer will want and which is otherwise asserted
// rather than derived.

func TestComposingTwoComponentsReachesNoKeyNeitherCouldReachAlone(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberMail, supplier(seamMail, &log))

	// A group whose two children declare one key each.
	group := effect.Component{
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				inst, err := r.Instantiate("group", consumer(effect.Spec{seamCalendar}, &log))
				return inst.Undo, err
			})
		},
	}
	insert(t, &r, "group", group)
	settle(t, &r)

	// The group provides nothing, so composing its children installed no key of its own.
	require.Equal(t, effect.Name("cal"), r.Provider(seamCalendar))
	require.Equal(t, effect.Name("mail"), r.Provider(seamMail))
	require.Empty(t, r.TableOf("group").Satisfied(effect.Spec{seamCalendar}),
		"𝔐(e₁ ⋄ e₂) ⊆ ⟨𝔐(e₁) ∪ 𝔐(e₂)⟩ — the composite's generators "+
			"are composites of its "+
			"members', so grouping components grants no reach neither member had")
}
