// metatheory_test.go —— §4.3: Preservation, Temporal Composability, Spatial Composability,
// Progress, Confluence. Red by design.
//
// These are the results that say the system as a whole behaves, as against any one fiber. They are
// also the ones nobody writes tests for, because each is a claim quantified over *all* sequences of
// steps — and a test that drives one sequence proves nothing about the others.
//
// The handle that makes them testable is `Registry.Step` / `StepAt`: the rules "are reactive only,
// in that no rule mentions a scheduler; the steps are any sequence of rule applications, so a
// theorem proved over all such sequences holds for every scheduling policy a runtime might adopt".
// Exposing one step at a time is what lets a test pick the sequence, including the adversarial
// ones.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── 4.3.1 Preservation — Theorem 64 ────────────────────────────────────────────────────────────
//
// "If F^t is well formed then so is F^{t+1}, whichever rule step t applies."
//
// A claim about **every intermediate state**, which is why `WellFormed` is on the contract at all.
// Checking it only at quiescence would miss exactly the states the invariant exists to rule out: a
// committed view naming a fiber that has been removed, two tables claiming one key, a parent
// pointer into nothing.

func TestEveryRuleApplicationPreservesWellFormedness(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	requireWellFormed := func(after string) {
		t.Helper()
		clause, ok := r.WellFormed()
		require.True(t, ok, "Def 63 clause (%d) broken after %s", clause, after)
	}

	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar, seamMail}, &log))
	requireWellFormed("O-Insert booker")
	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	requireWellFormed("O-Insert cal")
	insert(t, &r, fiberMail, supplier(seamMail, &log))
	requireWellFormed("O-Insert mail")

	// Interleave the two directions: bring it up, tear a provider out halfway, bring it back.
	for i := 0; ; i++ {
		step, ok := r.Step()
		if !ok {
			break
		}
		requireWellFormed(string(step.Rule) + "(" + string(step.Fiber) + ")")
		if i == 2 {
			retire(t, &r, fiberMail)
			requireWellFormed("O-Retire mail")
		}
	}
	requireWellFormed("quiescence")
}

// ── 4.3.2 Temporal Composability — Theorem 68 / Corollary 69 ───────────────────────────────────
//
// "Applying n's accumulator at γ^u leaves every fiber's table where those same steps would have
// left it from γ^b, the control fields lying outside the comparison."
//
// In words: **a fiber's whole participation is erasable, and erasing it leaves everyone else's work
// intact.** That is the property that makes uninstalling a block safe, and it is strictly stronger
// than "unload runs the disposers" — it says the neighbours are where their OWN steps put them,
// not merely that nothing crashed.

func TestADepartingFiberLeavesItsNeighboursExactlyAsTheirOwnStepsLeftThem(t *testing.T) {
	t.Parallel()
	var log []string

	// Run A: mail and calendar both come up, and a transient `im` fiber comes and goes between
	// them.
	var a effect.Registry
	insert(t, &a, fiberCal, supplier(seamCalendar, &log))
	insert(t, &a, fiberIM, supplier(seamIM, &log))
	insert(t, &a, fiberMail, supplier(seamMail, &log))
	settle(t, &a)
	retire(t, &a, fiberIM)
	settle(t, &a)
	require.NoError(t, a.Remove(fiberIM))

	// Run B: the same, with `im` never inserted at all.
	var b effect.Registry
	insert(t, &b, fiberCal, supplier(seamCalendar, &log))
	insert(t, &b, fiberMail, supplier(seamMail, &log))
	settle(t, &b)

	require.True(t, a.Coeffects().Equivalent(b.Coeffects(), []string{seamCalendar, seamMail, "im"}),
		"Cor 69: the state after im's episode closes is ≃_K the state its steps never happened. "+
			"Compared up to ≃ and at named keys, so a fresh generative id on the way back is "+
			"allowed and a leaked `im` binding is not")
	require.Equal(t, b.Snapshot(), a.Snapshot(),
		"and the control fields agree too: every neighbour is in the phase it would have been in")
}

// Theorem 68 holds at every u IN the episode, not only at its close — which is what makes a load
// interruptible. Corollary 69 is the special case u = close, and testing only that would leave the
// interesting half unmeasured.

func TestRecoveryIsExactAtEveryPointOfTheEpisodeNotOnlyAtItsClose(t *testing.T) {
	t.Parallel()
	var log []string

	var reference effect.Registry
	insert(t, &reference, fiberCal, supplier(seamCalendar, &log))
	settle(t, &reference)
	keys := []string{seamCalendar, seamMail, "im"}

	// Interrupt a three-step activation after each possible number of iterations, and check that
	// unwinding from there lands where the fiber had never begun.
	for stop := range 3 + 1 {
		var r effect.Registry
		insert(t, &r, fiberCal, supplier(seamCalendar, &log))
		insert(t, &r, fiberSlow, effect.Component{
			Requires: effect.Spec{seamCalendar},
			Effects: func(d effect.Deps) *effect.Iterator {
				return effect.Sequence(threeSteps(&log))
			},
		})
		settle(t, &r)
		retire(t, &r, fiberSlow)
		settle(t, &r)
		require.NoError(t, r.Remove(fiberSlow))

		insert(t, &r, fiberSlow, effect.Component{
			Requires: effect.Spec{seamCalendar},
			Effects: func(d effect.Deps) *effect.Iterator {
				return effect.Sequence(threeSteps(&log))
			},
		})
		for range stop + 1 { // L-Begin plus `stop` iterations
			_, ok := r.StepAt(fiberSlow)
			require.True(t, ok)
		}
		retire(t, &r, fiberSlow)
		settle(t, &r)

		require.True(t, r.Coeffects().Equivalent(reference.Coeffects(), keys),
			"interrupted after %d iteration(s), the accumulator still recovers exactly", stop)
	}
}
