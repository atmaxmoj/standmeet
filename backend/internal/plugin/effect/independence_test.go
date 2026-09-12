// independence_test.go —— **Theorem 47** and **Lemmas 66, 67, 78, 79**: why two components
// never interfere, and why that is a syntactic check rather than an observation. Red by design.
//
// Theorem 47 is the load-bearing one for the product, because it says independence is decidable
// from two manifests:
//
//	P₁ ∩ S₂ = P₂ ∩ S₁ = ∅, and every shared key commutative ⇒ independent
//
// and the paper's own closing note is that "Section 4 reads that disjointness off the two
// components' declarations". Lemma 66 then lifts it to the whole calculus — *every* sequence of
// steps is pairwise independent — and Lemma 78 turns that into the transposition property
// Confluence is proved from.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── Theorem 47 — independence, read off the declarations ───────────────────────────────────────

func TestIndependenceIsDecidedByTheTwoDeclarationsAlone(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	// cal provides `calendar`; mail provides `mail`; neither declares the other's.
	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberMail, supplier(seamMail, &log))
	// booker declares `calendar`, so P_cal ∩ S_booker ≠ ∅.
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))

	require.True(t, r.Independent(fiberCal, fiberMail),
		"P₁ ∩ S₂ = P₂ ∩ S₁ = ∅ — neither provides what the other requires")
	require.False(t, r.Independent(fiberCal, fiberBooker),
		"cal provides what booker declares, so the disjointness fails and the pair is entangled")
	require.True(t, r.Independent(fiberMail, fiberBooker),
		"booker does not declare `mail`, so this pair is independent even though both are in the "+
			"same registry and both are running")

	require.True(t, r.Independent(fiberCal, fiberMail),
		"and the answer was available before either had taken a single step: 'Section 4 reads "+
			"that disjointness off the two components' declarations'")
}

// Theorem 47's second hypothesis: a key at which operations of BOTH occur must be commutative. Two
// consumers of one seam are independent only if the seam's operations commute — which §3.4.2
// says is decided by what the seam returns.

func TestTwoConsumersOfOneSeamAreIndependentOnlyIfItsOperationsCommute(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, "booker-a", consumer(effect.Spec{seamCalendar}, &log))
	insert(t, &r, "booker-b", consumer(effect.Spec{seamCalendar}, &log))

	require.True(t, r.Independent("booker-a", "booker-b"),
		"neither provides anything, so the disjointness holds trivially; what remains is the "+
			"commutativity of `calendar`, which Def 46 makes the PROVIDER's obligation to witness")
}

// ── Lemma 66 — every sequence of steps is pairwise independent ────────────────────────────────
//
// The lift of Theorem 47 to the calculus: the rules admit no pair that is not independent, because
// O-Insert's disjointness premise is the hypothesis Theorem 47 needs. So the hypothesis of Theorem
// 43 (any-permutation recovery) and of Lemma 78 (transposition) is discharged by the calculus
// itself, once, rather than by each pair of components.

func TestTheCalculusAdmitsNoPairThatIsNotIndependent(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberMail, supplier(seamMail, &log))
	insert(t, &r, fiberIM, supplier(seamIM, &log))
	settle(t, &r)

	names := r.Names()
	for _, n := range names {
		for _, m := range names {
			if n == m {
				continue
			}
			require.True(t, r.Independent(n, m),
				"Lemma 66: %s and %s. Where the pair is not entangled through a declared key, "+
					"O-Insert's disjointness makes Theorem 47's hypothesis hold outright", n, m)
		}
	}
}

// ── Lemma 67 (Entangled steps) — an entangled fiber's steps move NOTHING while its consumer
// is installed
// ───────────────────────────────────────────────────────────────────────────────────
//
// Lemma 66 covers every pair that is independent. Lemma 67 is the other half, and it is the
// stronger statement: where `m` provides a key `n` declares, and `n`'s episode is open, **Ψ^t =
// id_Γ**.
//
// The proof is a chain worth stating because each link is a rule of the calculus:
//
//	ω_n holds m for as long as the episode is open (Lemma 59(2))
//	  ⇒ relied_m(γ^t) at every such t
//	  ⇒ the guard blocks every L-Unload of m
//	  ⇒ m never reaches Inactive
//	  ⇒ m is acted on only by L-Leave, O-Retire, and the blocked L-Unload
//	  ⇒ the first two have Ψ^t = id_Γ (Table 1)
//
// In product terms: **a supplier that is going away cannot change anything under a block that is
// still using it.** Not "is unlikely to", and not "only changes its own rows" — cannot, because
// the only rules available to it are ones that write control fields.

func TestAProviderLeavingCannotMoveTheWorldWhileItsConsumerIsStillInstalled(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))
	settle(t, &r)

	// Retire the provider and step it as far as the rules allow, while the consumer stays put.
	retire(t, &r, fiberCal)
	log = nil
	rules := drain(&r, fiberCal)

	require.Equal(t, []effect.Rule{effect.LLeave}, rules,
		"L-Leave, then nothing: the guard blocks L-Unload while relied_cal holds, and Table 1 "+
			"offers a non-Inactive fiber no other rule")
	require.Empty(t, log,
		"Lemma 67(1): Ψ^t = id_Γ. Not one binding moved — L-Leave and O-Retire write control "+
			"fields and nothing else, so a departing provider is inert until its consumers are "+
			"gone")

	f, _ := r.Get(fiberBooker)
	require.Equal(t, effect.PhaseActive, f.Phase, "and the consumer has not been disturbed at all")
}

// Lemma 67(3) — the same while the consumer is mid-activation. "Where moreover θ^t_n =
// Reloading(−,−,−), Ψ^t = id_Γ in either case", so a transition in flight cannot have the
// ground moved under it by anything it is entangled with.

func TestNothingEntangledCanMoveTheStateWhileAFiberIsMidActivation(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberSlow, effect.Component{
		Requires: effect.Spec{seamCalendar},
		Effects:  func(d effect.Deps) *effect.Iterator { return effect.Sequence(threeSteps(&log)) },
	})
	settle(t, &r)
	retire(t, &r, fiberSlow)
	settle(t, &r)
	require.NoError(t, r.Remove(fiberSlow))

	// Re-insert and leave it Reloading, mid-sequence.
	insert(t, &r, fiberSlow, effect.Component{
		Requires: effect.Spec{seamCalendar},
		Effects:  func(d effect.Deps) *effect.Iterator { return effect.Sequence(threeSteps(&log)) },
	})
	_, ok := r.StepAt(fiberSlow) // L-Begin
	require.True(t, ok)
	_, ok = r.StepAt(fiberSlow) // one iteration
	require.True(t, ok)

	f, _ := r.Get(fiberSlow)
	require.Equal(t, effect.PhaseReloading, f.Phase)

	retire(t, &r, fiberCal)
	log = nil
	_, ok = r.StepAt(fiberCal)
	require.True(t, ok, "L-Leave applies")
	_, ok = r.StepAt(fiberCal)
	require.False(t, ok,
		"and then nothing: Lemma 67(3) — a fiber entangled with one that is Reloading takes no "+
			"step that moves the state, so the transition in flight is never computed against "+
			"ground that shifted under it")
	require.Empty(t, log, "Ψ^t = id_Γ: no binding was withdrawn")

	require.True(t, r.TableOf(fiberCal).Satisfied(effect.Spec{seamCalendar}),
		"cal still HOLDS the binding — its accumulator has not run")
	require.False(t, r.Coeffects().Satisfied(effect.Spec{seamCalendar}),
		"…and has already left σ_γ, which is the union over Active fibers alone. The key went "+
			"out "+
			"of resolution without any state changing, which is exactly how a guard that would "+
			"otherwise deadlock comes to release")
}

// ── Lemma 78 — two adjacent steps at distinct fibers may be transposed ────────────────────────
//
// "If both apply an activation rule, e_m and e_n are independent, and step t+1 is applicable at
// γ^t, then step t is applicable at the state step t+1 produces, and **the two orders reach the
// same γ^{t+2}**."
//
// The step-level ingredient of Confluence, and the one worth testing on its own: Theorem 80 sorts a
// whole sequence by applying this repeatedly, so if transposition is wrong, Confluence fails in a
// way that only shows up on long histories.

func TestTwoAdjacentStepsAtDistinctFibersReachTheSameStateInEitherOrder(t *testing.T) {
	t.Parallel()
	keys := []string{seamCalendar, seamMail}

	build := func() *effect.Registry {
		r := &effect.Registry{}
		var log []string
		insert(t, r, fiberCal, supplier(seamCalendar, &log))
		insert(t, r, fiberMail, supplier(seamMail, &log))
		return r
	}

	// One step at cal, then one at mail.
	ab := build()
	_, ok := ab.StepAt(fiberCal)
	require.True(t, ok)
	_, ok = ab.StepAt(fiberMail)
	require.True(t, ok)

	// The transposition.
	ba := build()
	_, ok = ba.StepAt(fiberMail)
	require.True(t, ok)
	_, ok = ba.StepAt(fiberCal)
	require.True(t, ok)

	require.Equal(t, ab.Snapshot(), ba.Snapshot(),
		"Lemma 78(1): the two orders reach the same γ^{t+2}")
	require.True(t, ab.Coeffects().Equivalent(ba.Coeffects(), keys))

	settle(t, ab)
	settle(t, ba)
	require.Equal(t, ab.Snapshot(), ba.Snapshot(), "…and continue to agree to quiescence")
}

// Lemma 78(2): an activation step and an orchestration step at distinct fibers transpose too,
// **provided the activation does not instantiate the fiber the orchestration step acts on**. The
// exception is the interesting half — an O-Insert cannot move before the step that created the
// fiber it names, "its premises requiring that fiber to be present".

func TestAnOrchestrationStepCannotMoveAheadOfTheInstantiationThatCreatedItsFiber(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	host := effect.Component{
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				inst, err := r.Instantiate("host", supplier(seamMail, &log))
				return inst.Undo, err
			})
		},
	}
	insert(t, &r, "host", host)

	// Before the host activates, the child does not exist, so no rule can act on it.
	require.Len(t, r.Names(), 1)
	require.ErrorIs(t, r.Retire("nonexistent-child"), effect.ErrUnknownFiber,
		"Lemma 78(2)'s exception: an orchestration step at an instantiated fiber "+
			"'cannot go to the "+
			"front, its premises requiring that fiber to be present, so it stays where the "+
			"instantiation put it'")

	settle(t, &r)
	require.Len(t, r.Names(), 2, "and after the activation it exists and can be acted on")
}

// ── Lemma 79 — a closed episode can be DELETED from the history ───────────────────────────────
//
// The step Theorem 80 uses to normalise: an episode that closed can be removed from the sequence
// along with the steps of the fibers it instantiated, and the endpoint is unchanged up to those
// names. Corollary 69 is the same claim at one fiber; this is it as a rewriting of the history.
//
// Tested as: a fiber that came and went leaves a system indistinguishable from one where it never
// was — including when it instantiated children of its own, which is the part Cor 69 alone does
// not cover.

func TestAClosedEpisodeAndItsChildrenCanBeRemovedFromTheHistory(t *testing.T) {
	t.Parallel()
	keys := []string{seamCalendar, seamMail, "im"}
	var log []string

	// A host that instantiates a child, both of which come and go.
	withTransient := &effect.Registry{}
	insert(t, withTransient, fiberCal, supplier(seamCalendar, &log))
	host := effect.Component{
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				inst, err := withTransient.Instantiate("host", supplier(seamIM, &log))
				return inst.Undo, err
			})
		},
	}
	insert(t, withTransient, "host", host)
	settle(t, withTransient)
	retire(t, withTransient, "host")
	settle(t, withTransient)
	insert(t, withTransient, fiberMail, supplier(seamMail, &log))
	settle(t, withTransient)

	// The same orchestration steps with the host's episode deleted.
	without := &effect.Registry{}
	insert(t, without, fiberCal, supplier(seamCalendar, &log))
	insert(t, without, fiberMail, supplier(seamMail, &log))
	settle(t, without)

	require.True(t, withTransient.Coeffects().Equivalent(without.Coeffects(), keys),
		"Lemma 79: 'the lemma removes the episode, together with the steps of the names it "+
			"instantiated, leaving γ^T where it was up to those names'. The child's `im` binding "+
			"went with its parent, one level at a time, with nobody arranging the order")
}
