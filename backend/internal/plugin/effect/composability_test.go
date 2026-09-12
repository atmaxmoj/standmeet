// composability_test.go —— §4.3.3 Spatial Composability, §4.3.4 Progress, §4.3.5 Confluence,
// and the two static predictions they rest on. Red by design. Preservation and Temporal
// Composability are in metatheory_test.go.
//
// These four are the results an owner meets, in this order:
//
//   - **Resolution coherence** (Thm 71) — a transition never installs effects computed against a
//     resolution that moved under it.
//   - **Progress** (Thm 73) — the teardown guard always releases, and every sequence of steps
//     ends.
//   - **Confluence** (Thm 80) — clicking twice quickly lands where clicking once carefully would.
//   - and the two hypotheses those carry, `≺` acyclic and totality on the provision, which a real
//     system can violate and which `Cycles` / `Support` / `Total` make checkable rather than
//     assumed.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── 4.3.3 Spatial Composability — Theorem 71 (Resolution coherence) ────────────────────────────
//
// "Every iteration of the transition runs against the one resolution ω." A transition spread over
// steps must not install effects computed against a resolution that has changed under it.

func TestEveryIterationOfATransitionRunsAgainstOneResolution(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry
	var seen []effect.Name

	watcher := effect.Component{
		Requires: effect.Spec{seamCalendar},
		Effects: func(d effect.Deps) *effect.Iterator {
			step := func(next effect.Step) effect.Step {
				return func() (effect.Dispose, effect.Step, error) {
					seen = append(seen, d.View[seamCalendar])
					return func() error { return nil }, next, nil
				}
			}
			last := step(nil)
			return effect.Sequence(step(step(last)))
		},
	}

	insert(t, &r, "cal-a", supplier(seamCalendar, &log))
	insert(t, &r, "watch", watcher)
	drain(&r, "cal-a") // Thm 70: the consumer cannot begin before its dependency is provided

	_, ok := r.StepAt("watch") // L-Begin, committing ω = {calendar: cal-a}
	require.True(t, ok)
	_, ok = r.StepAt("watch") // one iteration
	require.True(t, ok)

	// The world turns underneath: the provider is retired mid-transition.
	retire(t, &r, "cal-a")
	settle(t, &r)

	for _, n := range seen {
		require.Equal(t, effect.Name("cal-a"), n,
			"L-Iter and L-Finish both carry target_n(γ) = ω as a premise, so a transition "+
				"proceeds "+
				"only while its committed view is still its target. A changed target takes the "+
				"fiber OUT through L-Divert; it never continues against a moved resolution")
	}
}

// Theorem 71's dichotomy, branch 2: where the fiber leaves the interval by L-Divert, "the episode
// closes at some u > r" having installed nothing. The branch that makes branch 1 safe.

// twoPhase —— provides a key across TWO iterations: the first installs it, the second would
// have finished the job. The gap between them is where an L-Divert can fall, and the whole point is
// that a divert there installs nothing.
func twoPhase() effect.Component {
	return effect.Component{
		Requires: effect.Spec{seamCalendar},
		Provides: []string{seamBooking},
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Sequence(func() (effect.Dispose, effect.Step, error) {
				undo, err := d.Own.Set(seamBooking, "half-built")
				if err != nil {
					return nil, nil, err
				}
				return undo, finished, nil
			})
		},
	}
}

// finished —— the last iteration of a sequence: yields Nothing.
//
// iteration three results — the new state, its inverse, and Maybe(next).
//
//nolint:revive // function-result-limit: this IS effect.Step, and Definition 17 gives an
func finished() (effect.Dispose, effect.Step, error) {
	return func() error { return nil }, nil, nil
}

func TestADivertedTransitionInstallsNothing(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, "half", twoPhase())
	drain(&r, fiberCal) // Thm 70 again: provided first, then the consumer may begin

	_, ok := r.StepAt("half") // L-Begin
	require.True(t, ok)
	_, ok = r.StepAt("half") // first iteration: installs `booking` into σ_half
	require.True(t, ok)

	require.True(t, r.TableOf("half").Satisfied(effect.Spec{seamBooking}),
		"the binding is in the fiber's own table…")
	require.False(t, r.Coeffects().Satisfied(effect.Spec{seamBooking}),
		"…and not in σ_γ, the fiber being Reloading rather than Active. Nothing could have "+
			"activated against a half-built provision")

	retire(t, &r, "half")
	settle(t, &r)
	require.False(t, r.TableOf("half").Satisfied(effect.Spec{seamBooking}),
		"and the divert withdrew it: an episode that never reached Active installed nothing")
}

// ── 4.3.4 Progress — Theorem 73 ────────────────────────────────────────────────────────────────
//
// (1) No deadlock: ¬quiet implies some lifecycle rule applies. The guard `¬relied_n` is a guard
// "of a kind that ordinarily deadlocks"; what saves it is that an Unloading fiber leaves σ_γ, so
// every consumer that committed to it is itself already on its way out.
//
// The chain is the test: a three-deep dependency line, all retired at once, where the middle fiber
// is blocked by the top and the top by nothing. A naive guard stalls here.

func TestATeardownChainNeverReachesAStateWhereNoRuleApplies(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	relay := func(needs, gives string) effect.Component {
		return effect.Component{
			Requires: effect.Spec{needs},
			Provides: []string{gives},
			Effects: func(d effect.Deps) *effect.Iterator {
				return effect.Once(func() (effect.Dispose, error) { return d.Own.Set(gives, "on") })
			},
		}
	}
	insert(t, &r, "bottom", supplier(seamCalendar, &log))
	insert(t, &r, "middle", relay(seamCalendar, "booking"))
	insert(t, &r, "top", consumer(effect.Spec{seamBooking}, &log))
	settle(t, &r)

	retire(t, &r, "bottom")
	retire(t, &r, "middle")
	retire(t, &r, "top")

	for !r.Quiet() {
		_, ok := r.Step()
		require.True(t, ok,
			"Thm 73(1): not quiet, so some lifecycle rule must apply. A guard that waits for "+
				"dependents while the dependents wait for it is the deadlock this arrangement "+
				"is designed to be immune to — and immunity comes from σ_γ's Active-only "+
				"union, "+
				"not from an ordering pass")
	}
}

// (2) Termination, with the paper's own bound: S(n) ≤ (K+3)(V(n)+1). Worth asserting as a number
// rather than as "it stopped", because an implementation that thrashes — reloading a fiber on
// every neighbour's step — terminates too, just uselessly, and only the count tells them apart.

func TestTheStepCountStaysWithinTheBoundTheoremSeventyThreeGives(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberMail, supplier(seamMail, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar, seamMail}, &log))

	steps := map[effect.Name]int{}
	for {
		step, ok := r.Step()
		if !ok {
			break
		}
		steps[step.Fiber]++
	}

	// len(e_n) = 1 for every component here, so K = 1 and the per-interval bound is K+3 = 4. The
	// target view of each turns at most twice coming up (unprovided → provided).
	const k = 1
	for n, s := range steps {
		require.LessOrEqual(t, s, (k+3)*(2+1),
			"S(%s) = %d exceeds (K+3)(V(n)+1); a fiber is being re-driven by steps that are not "+
				"its own", n, s)
	}
	require.True(t, r.Quiet(),
		"every maximal sequence of lifecycle steps ends in a quiescent state")
}

// ── 4.3.5 Confluence — Theorem 80 ──────────────────────────────────────────────────────────────
//
// "Whatever sequence of activations and deactivations a running system has been through, the state
// it quiesces at is the one the same insertions and retirements would have produced had each
// component that ends up active been loaded once, in dependency order, and none ever unloaded."
//
// This is the property an owner meets first — clicking twice quickly, or toggling a supplier off
// and on while another is still coming up. The two runs below take the same orchestration steps and
// different schedules.

func TestTwoSchedulesOverTheSameInputsQuiesceAtTheSameState(t *testing.T) {
	t.Parallel()
	var log []string
	keys := []string{seamCalendar, seamMail, seamBooking}

	build := func() *effect.Registry {
		r := &effect.Registry{}
		insert(t, r, fiberBooker, consumer(effect.Spec{seamCalendar, seamMail}, &log))
		insert(t, r, fiberCal, supplier(seamCalendar, &log))
		insert(t, r, fiberMail, supplier(seamMail, &log))
		return r
	}

	// Schedule one: let the system pick, whatever order that is.
	fair := build()
	settle(t, fair)

	// Schedule two: adversarial. Drive `mail` all the way up before touching `cal` at all, so the
	// consumer's target turns twice and it is started, diverted and started again.
	skewed := build()
	for {
		if _, ok := skewed.StepAt(fiberMail); !ok {
			break
		}
	}
	for {
		if _, ok := skewed.StepAt(fiberBooker); !ok {
			break
		}
	}
	settle(t, skewed)

	require.Equal(t, fair.Snapshot(), skewed.Snapshot(),
		"Thm 80(2): the schedule picks orders and exits and nothing else")
	require.True(t, fair.Coeffects().Equivalent(skewed.Coeffects(), keys),
		"and the tables agree up to ≃")
}

// Theorem 80(1), the canonical form: the quiesced state equals the one a single clean load in
// dependency order would have produced. The reason "restart everything" is never the right repair
// — the running system is already at that state.

func TestAChurnedSystemQuiescesWhereAFreshLoadWouldHave(t *testing.T) {
	t.Parallel()
	var log []string
	keys := []string{seamCalendar, seamMail, seamBooking}

	fresh := &effect.Registry{}
	insert(t, fresh, fiberCal, supplier(seamCalendar, &log))
	insert(t, fresh, fiberMail, supplier(seamMail, &log))
	insert(t, fresh, fiberBooker, consumer(effect.Spec{seamCalendar, seamMail}, &log))
	settle(t, fresh)

	churned := &effect.Registry{}
	insert(t, churned, fiberCal, supplier(seamCalendar, &log))
	insert(t, churned, fiberMail, supplier(seamMail, &log))
	insert(t, churned, fiberBooker, consumer(effect.Spec{seamCalendar, seamMail}, &log))
	settle(t, churned)
	for range 3 { // toggle a provider three times
		retire(t, churned, fiberMail)
		settle(t, churned)
		require.NoError(t, churned.Remove(fiberMail))
		insert(t, churned, fiberMail, supplier(seamMail, &log))
		settle(t, churned)
	}

	require.True(t, fresh.Coeffects().Equivalent(churned.Coeffects(), keys),
		"Thm 80(1): the dynamic history leaves no trace. If this fails, 'have you tried "+
			"restarting it' is a real repair — which is the admission that composition is not "+
			"actually spatiotemporal")
	require.Equal(t, fresh.Snapshot(), churned.Snapshot())
}
