// nesting_test.go —— §3.3.1: Definition 28, the unified context. Red by design.
//
//	Γ∞ := μΓ. Γ × (Γ → Γ) × Σ
//
// One recursive type carrying the state, the accumulator and the coeffect table, so that "effect
// maps 𝔈_Γ∞ to itself, unifying the ∂-tower into a single self-similar type".
//
// Two claims follow, and both are testable:
//
//  1. **There is no lifting.** The tower `∂Γ, ∂²Γ, …` that the construction climbs
//     collapses once the context is recursive. What an implementation needs is nesting — a tree
//     — and the API at depth three is the API at depth one. A `Lift` anywhere in this package
//     would be evidence the port took the construction and missed the collapse.
//  2. **Σ is reached through the scope, not beside it.** "Σ subsumes all shared mutable states,
//     not just inter-component dependencies. Every interaction between a component and its
//     environment passes through this single entity." Two entities is two doors, and the second one
//     is where a provision outlives the component that made it.

package effect_test

import (
	"maps"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── a child's effects are its own to revert ────────────────────────────────────────────────────

func TestAChildUnloadsAloneAndLeavesItsParentStanding(t *testing.T) {
	t.Parallel()
	w := newWorld()

	var parent effect.Scope
	mustEffect(t, &parent, "parent-work", set(w, "parent", valOne))

	child := parent.Child("child")
	mustEffect(t, child, "child-work", set(w, "child", valOne))

	require.NoError(t, child.Unload())
	require.NotContains(t, w, "child")
	require.Equal(t, "1", w["parent"],
		"'components at different levels of the hierarchy are independently loadable and "+
			"unloadable'")
	require.True(t, parent.Active())
	require.False(t, child.Active())
}

// ── and unloading the parent aggregates them ───────────────────────────────────────────────────

func TestUnloadingAParentAggregatesTheEffectsOfAllItsChildren(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)

	var parent effect.Scope
	mustEffect(t, &parent, "parent-work", set(w, "parent", valOne))
	a := parent.Child("a")
	mustEffect(t, a, "a-work", set(w, keyA, valOne))
	b := parent.Child("b")
	mustEffect(t, b, "b-work", set(w, keyB, valOne))

	require.NoError(t, parent.Unload())

	require.True(t, sameUnder(before, w, []string{"parent", keyA, keyB, "seeded"}),
		"'a parent context aggregates and manages the effects of all its children'")
	require.False(t, a.Active())
	require.False(t, b.Active())
}

// ── no lifting: depth three is depth one ───────────────────────────────────────────────────────
//
// The whole content of Definition 28. If the port had kept the tower, a grandchild would need a
// different type or a lift to be composed with its grandparent's accumulator; here it needs
// neither, and one Unload at the root reverts all three levels in LIFO across the tree.

func TestAGrandchildIsReachedByTheSameApiAsAChild(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)
	var order []string

	mark := func(k string) effect.Setup {
		return func() (effect.Dispose, error) {
			w[k] = "1"
			return func() error { order = append(order, k); delete(w, k); return nil }, nil
		}
	}

	var root effect.Scope
	mustEffect(t, &root, "l0", mark("l0"))
	l1 := root.Child("l1")
	mustEffect(t, l1, "l1", mark("l1"))
	l2 := l1.Child("l2")
	mustEffect(t, l2, "l2", mark("l2"))
	l3 := l2.Child("l3")
	mustEffect(t, l3, "l3", mark("l3"))

	require.NoError(t, root.Unload())

	require.Equal(t, []string{"l3", "l2", "l1", "l0"}, order,
		"Def 9's LIFO reaches across the tree, not merely within one level — which is what the "+
			"self-similar type buys and what a tower of lifted contexts would have to arrange "+
			"by hand at each level")
	require.True(t, sameUnder(before, w, []string{"l0", "l1", "l2", "l3", "seeded"}))
}

// ── Σ is reached THROUGH the scope ─────────────────────────────────────────────────────────────
//
// The test that decides whether the port took Definition 28 or merely quoted it. A provision made
// through the scope's own table is part of that scope's accumulator; a provision made into a table
// held beside the scope is not, and outlives the component that made it.

func TestAProvisionMadeThroughTheScopeIsWithdrawnByItsUnload(t *testing.T) {
	t.Parallel()

	var s effect.Scope
	mustEffect(t, &s, "provide-calendar", func() (effect.Dispose, error) {
		return s.Coeffects().Set(seamCalendar, "google")
	})
	require.True(t, s.Coeffects().Satisfied(effect.Spec{seamCalendar}))

	require.NoError(t, s.Unload())
	require.False(t, s.Coeffects().Satisfied(effect.Spec{seamCalendar}),
		"'every interaction between a component and its environment passes through this single "+
			"entity'. A Σ held beside the Scope rather than as a projection of it is the second "+
			"door, and a supplier that vanishes while its seam registration survives came "+
			"through it")
}

// ── a child sees its parent's bindings; isolating one does not disturb the parent ──────────────

func TestAChildSeesWhatItsParentBoundAndIsolatingDoesNotDisturbIt(t *testing.T) {
	t.Parallel()

	var parent effect.Scope
	_, err := parent.Coeffects().Set(seamCalendar, "google")
	require.NoError(t, err)

	child := parent.Child("visitor-session")
	require.True(t, child.Coeffects().Satisfied(effect.Spec{seamCalendar}),
		"Σ is derived from the parent's, so a child reads what its parent provided")

	// Def 24: the child resolves the key through a realm of its own. Derived, so no inverse.
	isolated := child.Coeffects().Isolate("calendar", "session-7")
	_, err = isolated.Set(seamCalendar, "fastmail")
	require.NoError(t, err)

	v, err := parent.Coeffects().Get(seamCalendar)
	require.NoError(t, err)
	require.Equal(t, "google", v,
		"isolation is a DERIVED realization (Def 23): it 'leaves the input intact and returns a "+
			"fresh context, with the identity as its inverse'. This is per-session seam "+
			"resolution, and the reason it needs no cleanup at all")
}

// ── a child refuses to outlive its parent ──────────────────────────────────────────────────────

func TestAChildOfAnUnloadedScopeIsRefused(t *testing.T) {
	t.Parallel()

	var parent effect.Scope
	require.NoError(t, parent.Unload())

	child := parent.Child("late")
	_, err := child.Effect("work", func() (effect.Dispose, error) {
		return func() error { return nil }, nil
	})
	require.ErrorIs(t, err, effect.ErrInactive,
		"a child that could register effects under an unloaded parent would hold an accumulator "+
			"nothing will ever run — the same leak ErrInactive exists to refuse one level up")
}
