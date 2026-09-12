// prediction_test.go —— Definition 74, Lemma 77 and §6.5: what the declarations decide before
// anything runs.
//
// The two questions an owner asks about a system that has not settled — *what will be running?*
// and *if nothing will, which components are the ring?* — are answered here from `τ, π, d, p`
// alone. That is what separates this from every other file in the suite: no step is taken to get
// the answer.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── Definition 74 / Lemma 77 — what will be Active is a function of the declarations ───────────

func TestTheSupportSetPredictsWhatEndsUpActiveBeforeAnythingRuns(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar, seamMail}, &log))
	insert(t, &r, "orphan", consumer(effect.Spec{"telepathy"}, &log))

	predicted := r.Support()
	require.ElementsMatch(t, []effect.Name{"cal"}, predicted,
		"Def 74 reads τ, π, d, p and nothing else — no lifecycle state, no step. booker "+
			"declares "+
			"`mail`, which nothing provides; orphan declares a key no component has")

	settle(t, &r)
	var active []effect.Name
	for n, p := range r.Snapshot() {
		if p == effect.PhaseActive {
			active = append(active, n)
		}
	}
	require.ElementsMatch(t, predicted, active,
		"Lemma 77: at quiescence the support set IS the Active set. The prediction was available "+
			"before the first step, which is what lets an owner be told why something is waiting")
}

// ── §6.5 / Definition 72 — a cycle is reportable at load, not a hang ───────────────────────────
//
// "Unlike deadlock in concurrent systems, which depends on the schedule and must be detected as it
// happens, this condition is predictable from the dependency declarations alone, so a runtime can
// report it when components are loaded."

func TestADependencyCycleIsReportedFromTheDeclarationsRatherThanHanging(t *testing.T) {
	t.Parallel()
	var r effect.Registry

	ring := func(needs, gives string) effect.Component {
		return effect.Component{
			Requires: effect.Spec{needs},
			Provides: []string{gives},
			Effects: func(d effect.Deps) *effect.Iterator {
				return effect.Once(func() (effect.Dispose, error) { return d.Own.Set(gives, "on") })
			},
		}
	}
	insert(t, &r, fiberA, ring("beta", "alpha"))
	insert(t, &r, fiberB, ring("alpha", "beta"))

	cycles := r.Cycles()
	require.Len(t, cycles, 1)
	require.ElementsMatch(t, []effect.Name{"a", "b"}, cycles[0],
		"the names are in the report, so the owner is told WHICH two — the thing a spinner "+
			"cannot say")

	require.NoError(t, r.Settle(),
		"and the system does not hang: a cycle 'simply leaves the involved components "+
			"permanently inactive'")
	require.True(t, r.Quiet())
	require.Empty(t, r.Support())
}
