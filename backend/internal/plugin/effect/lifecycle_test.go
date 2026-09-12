// lifecycle_test.go —— §4.2.2: the six lifecycle rules, the ones the system applies
// unprompted. Red by design. Fixtures and the orchestration rules are in fiber_test.go.
//
// Everything here turns on one structural fact: **σ_γ is the union over Active fibers alone**
// (equation 46). Because of it, marking a fiber `Unloading` removes it from the coeffect context
// before it has withdrawn a single binding — which is what gives a teardown an interval to run
// in, and what keeps the guard `¬relied_n(γ)` from being the deadlock it looks like.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── equation (46) — σ is the union over ACTIVE fibers alone ────────────────────────────────────
//
// The sharp one, and the one a stored seam→supplier table cannot satisfy. A fiber that L-Leave
// has marked `Unloading` still HOLDS its binding — its table is untouched until L-Unload runs the
// accumulator — but it is no longer a provider. "A key its transition has already written is not
// yet one a dependent may activate against."

func TestAFiberInTransitionProvidesNothingThoughItsTableStillHoldsTheBinding(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))
	settle(t, &r)

	// Retire the provider and take exactly one step at it: L-Leave, the decision, not the act.
	retire(t, &r, fiberCal)
	rule, ok := r.StepAt(fiberCal)
	require.True(t, ok)
	require.Equal(t, effect.LLeave, rule)

	f, _ := r.Get(fiberCal)
	require.Equal(t, effect.PhaseUnloading, f.Phase)

	require.True(t, r.TableOf(fiberCal).Satisfied(effect.Spec{seamCalendar}),
		"σ_cal is untouched: L-Leave 'records the decision to deactivate without acting on it'")
	require.False(t, r.Coeffects().Satisfied(effect.Spec{seamCalendar}),
		"…and yet σ_γ no longer has the key, the union being over Active fibers alone. This "+
			"gap is "+
			"what keeps the guard from deadlocking, and it is why σ must be DERIVED: a stored "+
			"provider table has one value here and needs two")
	require.Equal(t, effect.Name(""), r.Provider(seamCalendar))
}

// ── §4.2.2 — the decision is separated from the act, and the guard fills the gap ───────────────
//
// Theorem 70(2): a provider outlives its consumer. And more than outlives — the consumer's
// teardown can still READ the key while it runs, which is the whole reason the interval exists.

func TestTheProviderWithdrawsOnlyAfterItsConsumersTeardownHasRun(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))
	settle(t, &r)
	log = nil

	retire(t, &r, fiberCal)
	settle(t, &r)

	require.Equal(t, []string{"consume:down", "withdraw:calendar"}, log,
		"Thm 70(2): the consumer's episode closes strictly inside the provider's. Its teardown "+
			"read `calendar` and did not fail, so the binding was still reachable while it ran")
}

func TestTheGuardHoldsTheUnloadBackWhileAConsumerStillNamesIt(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))
	settle(t, &r)

	retire(t, &r, fiberCal)
	_, ok := r.StepAt(fiberCal) // L-Leave
	require.True(t, ok)

	require.True(t, r.Relied(fiberCal),
		"Def 54: booker is installed and ω_booker(calendar) = cal")
	_, ok = r.StepAt(fiberCal)
	require.False(t, ok,
		"L-Unload's premise ¬relied_n(γ) fails, so no rule applies to cal — the provider is "+
			"held")

	// The consumer, meanwhile, has been taken out of service by its target view turning ⊥, and
	// stepping it releases the guard. Nothing coordinated the two.
	drain(&r, fiberBooker)
	require.False(t, r.Relied(fiberCal))
	rule, ok := r.StepAt(fiberCal)
	require.True(t, ok)
	require.Equal(t, effect.LUnload, rule,
		"the guard released on its own: an Unloading fiber leaves σ_γ, so no target view can "+
			"name "+
			"it any longer and every consumer that committed to it is itself on its way out")
}

// ── L-Divert — a transition interrupted mid-flight routes through Unloading, never through
// Active
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "Routing through Active instead would let the fiber provide its coeffects for the length of one
// step and oblige its dependents to activate against a component that is already leaving."

func TestATransitionInterruptedMidFlightRoutesThroughUnloading(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	// A three-step activation, so there is a boundary to interrupt at.
	slow := effect.Component{
		Requires: effect.Spec{seamCalendar},
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Sequence(threeSteps(&log))
		},
	}
	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberSlow, slow)

	settle(t, &r)
	retire(t, &r, fiberSlow) // undo Settle's completion for the interesting half
	settle(t, &r)
	require.NoError(t, r.Remove(fiberSlow))

	// Re-insert and drive it by hand so the interruption lands between two iterations.
	insert(t, &r, fiberSlow, slow)
	rule, ok := r.StepAt(fiberSlow)
	require.True(t, ok)
	require.Equal(t, effect.LBegin, rule)
	rule, ok = r.StepAt(fiberSlow)
	require.True(t, ok)
	require.Equal(t, effect.LIter, rule)

	// Now the target turns, mid-transition.
	retire(t, &r, fiberSlow)
	var phases []effect.Phase
	for {
		f, _ := r.Get(fiberSlow)
		phases = append(phases, f.Phase)
		if _, more := r.StepAt(fiberSlow); !more {
			break
		}
	}
	require.NotContains(t, phases, effect.PhaseActive,
		"L-Divert takes a Reloading fiber straight to Unloading with the inverses accumulated so "+
			"far. Passing through Active would publish its coeffects for one step and invite a "+
			"dependent to activate against something already leaving")
	f, _ := r.Get(fiberSlow)
	require.Equal(t, effect.PhaseInactive, f.Phase)
}

// threeSteps —— an activation with two interior boundaries.
func threeSteps(log *[]string) effect.Step {
	var mk func(n int) effect.Step
	mk = func(n int) effect.Step {
		return func() (effect.Dispose, effect.Step, error) {
			*log = append(*log, "step-up")
			undo := func() error { *log = append(*log, "step-down"); return nil }
			if n == 3 {
				return undo, nil, nil
			}
			return undo, mk(n + 1), nil
		}
	}
	return mk(1)
}

// ── Definition 48 — no key outside p is one its effect function installs a binding at ──────────

func TestInstallingOutsideTheDeclaredProvisionIsRefused(t *testing.T) {
	t.Parallel()
	var r effect.Registry

	liar := effect.Component{
		Provides: []string{seamCalendar},
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				return d.Own.Set(seamMail, "surprise") // not in Provides
			})
		},
	}
	insert(t, &r, "liar", liar)
	settle(t, &r)

	require.False(t, r.Coeffects().Satisfied(effect.Spec{seamMail}),
		"Def 48 makes `Provides` a bound on what the effect function may install, so the whole of "+
			"§4.3 can read the declarations and not the runtime. A component that installs "+
			"outside p makes the support set (Def 74) wrong, and the support set is what Thm 80 "+
			"says the quiesced state equals")
	f, _ := r.Get("liar")
	require.Equal(t, effect.PhaseInactive, f.Phase, "the activation failed and withdrew itself")
}

// ── Definition 55 clause (2) — a component may not reach a key it never declared ───────────────

func TestAComponentCannotReachAnUndeclaredKey(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry
	var reachErr error

	snoop := effect.Component{
		Requires: effect.Spec{seamCalendar},
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				_, _, reachErr = d.Use("mail", func(v any) effect.Outcome {
					return effect.Outcome{Value: v, Defined: true}
				})
				return func() error { return nil }, nil
			})
		},
	}
	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberMail, supplier(seamMail, &log))
	insert(t, &r, "snoop", snoop)
	settle(t, &r)

	require.Error(t, reachErr,
		"confinement clause (2): what a component may neither read nor write is 'a table outside "+
			"the two declarations, any control field, or anything no table holds'. `mail` is "+
			"provided and Active — and still out of reach, because this component never declared "+
			"it")
}
