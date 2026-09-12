// teardown_shapes_test.go —— the uninstall topologies where a hand-rolled teardown order
// breaks. Red by design. The chain cases and the shared fixtures are in `teardown_test.go`.
//
//	fan-in     {A, B} → C     one provider, several dependents: the LAST one releases it
//	diamond    A → {B,C} → D  two paths to one provider, and neither order is privileged
//	tree       parent ⊃ child ordered along coeffects, NOT along the fiber tree
//	cycle      A ⇄ B          never activates, and does not wedge anything else
//	stuck      a disposer errors, and must not strand the fibers behind it
//	finish     every fiber reaches the state O-Remove's premises admit

package effect_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── fan-in: one provider, several dependents ──────────────────────────────────────────────────
//
// The guard is per *binding*, not per fiber, so the provider waits for the last of them and not for
// the first. A guard that released on "no consumer is Active any more" would let the provider go
// while a consumer was still Unloading — i.e. still running teardown code that reads the key.

func TestAProviderWaitsForTheLastOfItsDependentsNotTheFirst(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	for _, n := range []effect.Name{"c1", "c2", "c3"} {
		insert(t, &r, n, consumer(effect.Spec{seamCalendar}, &log))
	}
	settleWithoutStalling(t, &r)

	retire(t, &r, fiberCal)
	_, ok := r.StepAt(fiberCal) // L-Leave
	require.True(t, ok)

	// Take two of the three consumers all the way out. The provider must still be held.
	for _, n := range []effect.Name{"c1", "c2"} {
		drain(&r, n)
	}
	require.True(t, r.Relied(fiberCal), "c3 still resolves `calendar` to cal")
	_, ok = r.StepAt(fiberCal)
	require.False(t, ok, "so no rule applies to cal — two of three is not enough")

	drain(&r, "c3")
	rule, ok := r.StepAt(fiberCal)
	require.True(t, ok)
	require.Equal(t, effect.LUnload, rule, "and the last one releases it")
}

// ── diamond: two paths to one provider ────────────────────────────────────────────────────────
//
//	      cal
//	     ↙    ↘
//	  left    right        both provide, both consume `calendar`
//	     ↘    ↙
//	      top              consumes both
//
// Two orders are possible for left and right, and the calculus commits to neither (§4.2.2: "the
// relation commits to no order among them"). Both must work, and both must reach the same place.

func TestADiamondComesDownWhicheverSideGoesFirst(t *testing.T) {
	t.Parallel()
	keys := []string{seamCalendar, "left", "right"}

	build := func(log *[]string) *effect.Registry {
		r := &effect.Registry{}
		insert(t, r, fiberCal, supplier(seamCalendar, log))
		insert(t, r, "left", relay(seamCalendar, "left", log))
		insert(t, r, "right", relay(seamCalendar, "right", log))
		insert(t, r, "top", consumer(effect.Spec{"left", "right"}, log))
		return r
	}

	drain := func(r *effect.Registry, order ...effect.Name) {
		for _, n := range order {
			drain(r, n)
		}
		settleWithoutStalling(t, r)
	}

	var logA, logB []string
	a := build(&logA)
	settleWithoutStalling(t, a)
	retire(t, a, fiberCal)
	drain(a, "top", "left", "right", "cal")

	b := build(&logB)
	settleWithoutStalling(t, b)
	retire(t, b, fiberCal)
	drain(b, "top", "right", "left", "cal")

	require.Equal(t, a.Snapshot(), b.Snapshot(),
		"left-first and right-first reach the same quiescent state (Thm 80)")
	require.True(t, a.Coeffects().Equivalent(b.Coeffects(), keys))
	require.Empty(t, a.Support(), "nothing is left supported")
	require.Empty(t, b.Support())
}

// ── the fiber tree is NOT the teardown order ──────────────────────────────────────────────────
//
// "The guard orders deactivations along coeffects and **not along the fiber tree**: a parent may
// run its inverse while a child of it is still Unloading, since `relied` speaks only of committed
// views."
//
// A natural implementation orders teardown by the tree — children first, always — and that is
// wrong in both directions: it blocks a parent that nothing depends on, and it does not protect a
// child that some unrelated fiber does depend on.

func TestAParentMayUnloadWhileItsChildIsStillUnloading(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	// The child provides a key nothing declares, so it holds nobody up and nobody holds it up.
	host := effect.Component{
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				inst, err := r.Instantiate("host", supplier(seamIM, &log))
				if err != nil {
					return nil, err
				}
				return inst.Undo, nil
			})
		},
	}
	insert(t, &r, "host", host)
	settleWithoutStalling(t, &r)

	var child effect.Name
	for _, n := range r.Names() {
		if n != "host" {
			child = n
		}
	}
	require.NotEmpty(t, child)

	retire(t, &r, "host")
	// Step the PARENT only. If teardown were ordered by the tree it would be blocked here.
	rules := drain(&r, "host")
	require.Contains(t, rules, effect.LUnload,
		"the parent ran its accumulator with the child untouched — `relied` speaks only of "+
			"committed views, and the child declares nothing of the parent's")

	settleWithoutStalling(t, &r)
	f, _ := r.Get(child)
	require.True(t, f.Retired,
		"and the child was retired by the parent's inverse, one level at a time")
}

// ── a cycle: never activates, never hangs, and is reportable before it is driven ──────────────

func TestAMutuallyDependentPairNeitherActivatesNorWedgesTheTeardown(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, "x", relay("y-key", "x-key", &log))
	insert(t, &r, "y", relay("x-key", "y-key", &log))

	require.Len(t, r.Cycles(), 1, "reportable from the declarations, before any step")
	settleWithoutStalling(t, &r)

	require.ElementsMatch(t, []effect.Name{"cal"}, r.Support(),
		"the ring is permanently inactive; the fiber outside it is unaffected")

	retire(t, &r, fiberCal)
	retire(t, &r, "x")
	retire(t, &r, "y")
	settleWithoutStalling(t, &r)
	require.True(t, r.Quiet(), "and the cycle does not wedge the teardown of anything else")
}

// ── a stuck disposer must not wedge the fibers behind it ──────────────────────────────────────
//
// The failure an owner will actually hit: one block's cleanup throws, and everything under it is
// stranded. `Unload` runs every disposer and joins the errors, so the accumulator completes and the
// guard releases — the error is reported, and the chain still comes down.

func TestOneStuckTeardownReportsItsErrorWithoutStrandingTheChainBelow(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry
	stuck := errors.New("this block's cleanup is broken")

	broken := effect.Component{
		Requires: effect.Spec{seamCalendar},
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				return func() error { return stuck }, nil
			})
		},
	}
	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, "broken", broken)
	settleWithoutStalling(t, &r)
	log = nil

	retire(t, &r, fiberCal)
	settleWithoutStalling(t, &r)

	require.Equal(t, []string{"withdraw:calendar"}, log,
		"the provider's own inverse ran: a consumer whose teardown failed is still OUT of the "+
			"committed views, so the guard released. Holding the provider hostage to a broken "+
			"consumer would turn one bad disposer into an instance that can never be changed")
	f, _ := r.Get(fiberCal)
	require.Equal(t, effect.PhaseInactive, f.Phase)
	require.False(t, r.Coeffects().Satisfied(effect.Spec{seamCalendar}))
}

// ── uninstall finishes: the entry can actually be removed at the end ──────────────────────────
//
// O-Remove's premises are `τ ∧ Inactive ∧ σ = ∅ ∧ no children`. The point of the whole
// teardown is to reach a state where they hold — if they never do, "uninstall" is a button that
// cannot complete, and this is the assertion that says it completes.

func TestEveryFiberInARetiredChainBecomesRemovable(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberA, supplier(seamCalendar, &log))
	insert(t, &r, fiberB, relay(seamCalendar, "booking", &log))
	insert(t, &r, fiberC, consumer(effect.Spec{seamBooking}, &log))
	settleWithoutStalling(t, &r)

	for _, n := range []effect.Name{"a", "b", "c"} {
		retire(t, &r, n)
	}
	settleWithoutStalling(t, &r)

	for _, n := range []effect.Name{"c", "b", "a"} {
		require.NoError(t, r.Remove(n),
			"%s reached τ ∧ Inactive ∧ σ = ∅ ∧ no children — the removal discards "+
				"nothing, which "+
				"is what makes it safe and what a DELETE never establishes", n)
	}
	require.Empty(t, r.Names())
}
