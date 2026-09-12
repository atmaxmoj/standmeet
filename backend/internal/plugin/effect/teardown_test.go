// teardown_test.go —— uninstall: the deadlock the guard invites, and the cascade it produces.
// Red by design.
//
// The guard on L-Unload is `¬relied_n(γ)`: a provider may not run its accumulator while any
// installed fiber's committed view still names it. §4.2.2 says the quiet part out loud —
//
//	"**A guard of this kind ordinarily deadlocks.** What keeps it from doing so is Unloading
//	 together with σ_γ being the union over Active fibers alone: once L-Leave or L-Divert has
//	 marked n, its table leaves σ_γ, so no target view can name n any longer, and every consumer
//	 that committed to n is itself on its way out."
//
// So the no-deadlock property rests on **one** structural fact, and if that fact is implemented
// wrong — if σ_γ is a stored table, or if it unions Unloading fibers too — the system wedges
// on uninstall and the symptom is a spinner. This file is the pressure test for exactly that,
// across the topologies where a hand-rolled teardown ordering breaks:
//
//	chain      A → B → C          the second-order cascade
//	diamond    A → {B, C} → D     two paths to one provider
//	fan-in     {A, B} → C         one provider, several dependents
//	tree       parent ⊃ child     ordered along coeffects, NOT along the fiber tree
//	cycle      A ⇄ B              never activates, and says so at load
//	stuck      a disposer errors  must not wedge the fibers behind it
//
// A separate file from `composability_test.go` because Progress there is the theorem; this is the
// product behaviour it buys, and it is the one an owner meets on the day something has to come out.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// relay —— consumes one key and provides another: the middle of a chain.
func relay(needs, gives string, log *[]string) effect.Component {
	return effect.Component{
		Requires: effect.Spec{needs},
		Provides: []string{gives},
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				*log = append(*log, "up:"+gives)
				undo, err := d.Own.Set(gives, "on")
				if err != nil {
					return nil, err
				}
				return func() error {
					*log = append(*log, "down:"+gives)
					return undo()
				}, nil
			})
		},
	}
}

// settleWithoutStalling —— drive to quiescence, failing the moment the registry is not quiet
// and no rule applies. That state is the deadlock, and `Settle` alone would hide it behind a
// timeout. maxSteps —— far above any bound Theorem 73 allows here, so tripping it means a
// livelock rather than a slow settle.
const maxSteps = 1000

func settleWithoutStalling(t *testing.T, r *effect.Registry) {
	t.Helper()
	for i := 0; !r.Quiet(); i++ {
		require.Less(t, i, maxSteps, "did not reach quiescence in %d steps", maxSteps)
		_, ok := r.Step()
		require.True(t, ok,
			"DEADLOCK at step %d: the registry is not quiet and no lifecycle rule applies. "+
				"Thm 73(1) says this is unreachable under an acyclic ≺, so reaching it means "+
				"σ_γ is not the Active-only union it has to be", i)
	}
}

// ── the second-order cascade: A → B → C, and only A is retired ────────────────────────────────
//
// Nobody retires B or C. Retiring A turns B's target view to ⊥, which turns C's, and the whole
// line comes down in the one order that is safe — **and the inverses run bottom-up while the
// withdrawals run top-down**, which is the part that has to be got right.
//
// This is the shape every real uninstall has: a supplier under a block under a code. A hand-written
// teardown gets it right for two levels and forgets the third.

func TestRetiringOneProviderBringsDownTheWholeChainAboveIt(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberA, supplier(seamCalendar, &log))
	insert(t, &r, fiberB, relay(seamCalendar, "booking", &log))
	insert(t, &r, fiberC, consumer(effect.Spec{seamBooking}, &log))
	settleWithoutStalling(t, &r)
	log = nil

	require.NoError(t, r.Retire(fiberA), "only A is retired; B and C are not touched")
	settleWithoutStalling(t, &r)

	require.Equal(t, []string{"consume:down", "down:booking", "withdraw:calendar"}, log,
		"the cascade runs top-down: C's teardown first, then B's, then A's. Each ran while the "+
			"key it depends on was still reachable, and nothing arranged that — the guard did")

	for _, n := range []effect.Name{"a", "b", "c"} {
		f, _ := r.Get(n)
		require.Equal(t, effect.PhaseInactive, f.Phase, "%s came down", n)
	}
	require.False(t, r.Coeffects().Satisfied(effect.Spec{seamCalendar}))
	require.False(t, r.Coeffects().Satisfied(effect.Spec{seamBooking}))
}

// The same chain, retired in the **worst** order the owner could choose: the provider first, then
// nothing else. Already covered above. Here: every fiber retired at once, which is what "uninstall
// everything" does, and where a naive guard is most likely to wedge.

func TestRetiringAnEntireChainAtOnceStillComesDownInDependencyOrder(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberA, supplier(seamCalendar, &log))
	insert(t, &r, fiberB, relay(seamCalendar, "booking", &log))
	insert(t, &r, fiberC, consumer(effect.Spec{seamBooking}, &log))
	settleWithoutStalling(t, &r)
	log = nil

	retire(t, &r, fiberA)
	retire(t, &r, fiberB)
	retire(t, &r, fiberC)
	settleWithoutStalling(t, &r)

	require.Equal(t, []string{"consume:down", "down:booking", "withdraw:calendar"}, log,
		"retiring all three simultaneously does not license tearing them down simultaneously: "+
			"the guard still orders the inverses, so C's teardown reads `booking` and B's reads "+
			"`calendar` while both are still there")
}

// And retired in reverse — the owner clicks the top of the stack first. The order of the
// *requests* is not the order of the *acts*, which is the whole point of separating O-Retire from
// L-Unload.

func TestTheOrderRetirementsAreRequestedInDoesNotChangeTheOrderTheyHappenIn(t *testing.T) {
	t.Parallel()
	keys := []string{seamCalendar, seamBooking}

	build := func(log *[]string) *effect.Registry {
		r := &effect.Registry{}
		insert(t, r, fiberA, supplier(seamCalendar, log))
		insert(t, r, fiberB, relay(seamCalendar, "booking", log))
		insert(t, r, fiberC, consumer(effect.Spec{seamBooking}, log))
		return r
	}

	var topFirst, bottomFirst []string
	rt := build(&topFirst)
	settleWithoutStalling(t, rt)
	topFirst = nil
	retire(t, rt, fiberC)
	retire(t, rt, fiberB)
	retire(t, rt, fiberA)
	settleWithoutStalling(t, rt)

	rb := build(&bottomFirst)
	settleWithoutStalling(t, rb)
	bottomFirst = nil
	retire(t, rb, fiberA)
	retire(t, rb, fiberB)
	retire(t, rb, fiberC)
	settleWithoutStalling(t, rb)

	require.Equal(t, topFirst, bottomFirst,
		"same acts, same order, whichever order the requests arrived in — O-Retire 'is a "+
			"request, "+
			"and the lifecycle rules are what carry it out'")
	require.Equal(t, rt.Snapshot(), rb.Snapshot())
	require.True(t, rt.Coeffects().Equivalent(rb.Coeffects(), keys))
}
