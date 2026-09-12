// invariants_test.go —— **Lemmas 57, 59, 60, 61, 62 and 75**: the structural facts §4.3's
// theorems are assembled from. Red by design.
//
// Every one of them is a claim about what a rule may and may not touch. Together they are why
// "Table 1 is a complete inventory of the writes" is true, and every theorem in §4.3 that reasons
// by cases over the rules depends on that being true.
//
// They are also the cheapest place to catch a whole class of implementation error, because each
// names a field and says who may write it. An implementation that lets a second rule write `ω`, or
// lets an effect function move another fiber's table domain, will pass Preservation and Confluence
// on small examples and fail them on real ones.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── Lemma 59(5) — the declarations are written once, and τ is monotone ────────────────────────
//
// "π_n, d_n, p_n and e_n come into existence with the entry of n and are never written again, and
// τ_n is monotone, written only at ⊤ and only by an O-Retire."
//
// This is what makes `≺`, `Support` and `Cycles` answers rather than snapshots: the fields they
// read cannot change under them. A system that let a component revise its own `Requires` at runtime
// would make every static prediction in support.go a lie.

func TestTheDeclarationsAreWrittenOnceAndRetirementIsMonotone(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))

	before, _ := r.Get(fiberBooker)
	settle(t, &r)
	retire(t, &r, fiberCal)
	settle(t, &r)

	after, _ := r.Get(fiberBooker)
	require.Equal(t, before.Requires, after.Requires, "d is never written again")
	require.Equal(t, before.Provides, after.Provides, "nor p")
	require.Equal(t, before.Parent, after.Parent, "nor π")

	// τ is monotone: nothing carries it back to ⊥.
	retire(t, &r, fiberBooker)
	settle(t, &r)
	f, _ := r.Get(fiberBooker)
	require.True(t, f.Retired)
	// O-Insert's fourth premise reads dom(F_γ), and `cal` is still in it: retired is not removed.
	// The seam is only free once the entry is gone.
	require.NoError(t, r.Remove(fiberCal))
	insert(t, &r, "cal2", supplier(seamCalendar, &log))
	settle(t, &r)
	f, _ = r.Get(fiberBooker)
	require.True(t, f.Retired,
		"a retired fiber does not come back when its dependency does. §6.5 notes the calculus has "+
			"no rule writing τ back to ⊥ 'for two reasons: Theorem 80 rests on a fiber an "+
			"accumulator retired staying retired'")
	require.Equal(t, effect.PhaseInactive, f.Phase)
}

// ── Lemma 59(2) — ω is written only by L-Begin and cleared only by L-Unload ───────────────────
//
// "so ω^t_n is constant for t in an episode of n."
//
// The fixity of ω over an episode is what Theorem 70 and Theorem 71 are both proved from — the
// paper calls them "two halves of one invariant, namely the fixity of ω_n over an episode that
// Lemma 59(2) establishes". If any other rule could touch ω, both theorems go.

func TestTheCommittedViewIsFixedForTheWholeEpisode(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))

	// Drive booker by hand and record ω at every step of its episode.
	var seen []effect.View
	settle(t, &r)
	retire(t, &r, fiberCal) // turns booker's target, opening the deactivating half
	for {
		f, ok := r.Get(fiberBooker)
		require.True(t, ok)
		if f.Installed() {
			seen = append(seen, f.Committed)
		}
		if _, more := r.Step(); !more {
			break
		}
	}

	require.NotEmpty(t, seen)
	for _, v := range seen {
		require.Equal(t, effect.View{"calendar": "cal"}, v,
			"ω is constant across the episode — including the whole deactivating half, where "+
				"the "+
				"provider has already stopped providing. That is what lets a teardown still read "+
				"the key it is being torn down over")
	}
}

// ── Lemma 59(3) — the accumulator is applied by L-Unload and by nothing else ──────────────────
//
// "Ψ^t = g^t_n only where step^t = L-Unload(n), and no other step applies g_n to the state."
//
// L-Divert in particular does **not** apply one — it routes the fiber into Unloading carrying the
// inverses accumulated so far. An implementation that ran the accumulator at the divert would
// revert while the fiber was still resolving, before the guard had a chance to hold it.

func TestOnlyOneRuleEverAppliesAnAccumulator(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberSlow, effect.Component{
		Requires: effect.Spec{seamCalendar},
		Effects:  func(d effect.Deps) *effect.Iterator { return effect.Sequence(threeSteps(&log)) },
	})

	// The provider first: Theorem 70 says a fiber begins a transition ONLY where its dependencies
	// are provided, so `slow` has no rule available until `cal` is Active.
	drain(&r, fiberCal)

	// Begin, take one iteration, then turn the target so the next rule is L-Divert.
	_, ok := r.StepAt(fiberSlow)
	require.True(t, ok)
	_, ok = r.StepAt(fiberSlow)
	require.True(t, ok)
	retire(t, &r, fiberSlow)

	log = nil
	rule, ok := r.StepAt(fiberSlow)
	require.True(t, ok)
	require.Equal(t, effect.LDivert, rule)
	require.Empty(t, log,
		"L-Divert applies no accumulator: it 'routes the fiber into Unloading with the inverses "+
			"accumulated so far rather than applying them on the spot'")

	rule, ok = r.StepAt(fiberSlow)
	require.True(t, ok)
	require.Equal(t, effect.LUnload, rule)
	require.NotEmpty(t, log,
		"L-Unload is 'the only rule in the calculus that applies an accumulator'")
}

// ── Lemma 57 / Definition 55 — an effect function moves no other fiber's table DOMAIN ─────────
//
// Confinement clause (1) permits exactly one write outside the fiber's own table: values at keys
// the component declared. The **domain** of another fiber's table is not among them.
//
// That is what Lemma 59(1) rests on, and through it Theorem 70(3) — "σ^t_n(k) moves only by
// operations at k of fibers declaring k" — so a component cannot make a key disappear from under
// another component by operating on it.

func TestAComponentOperatingOnADeclaredKeyCannotRemoveIt(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))
	insert(t, &r, "other", consumer(effect.Spec{seamCalendar}, &log))
	settle(t, &r)

	// booker operates on `calendar`, which it declared: permitted, and it moves a value.
	f, _ := r.Get(fiberBooker)
	require.Equal(t, effect.PhaseActive, f.Phase)

	require.True(t, r.Coeffects().Satisfied(effect.Spec{seamCalendar}),
		"the key's presence is untouched by any consumer's operation: dom(σ_m) is unchanged, "+
			"'the two tables differ in values at keys of d_n alone'")
	require.Equal(t, effect.Name("cal"), r.Provider(seamCalendar))
	g, _ := r.Get("other")
	require.Equal(t, effect.PhaseActive, g.Phase,
		"so a second consumer of the same seam is undisturbed by the first one using it")
}

// ── Lemma 60 (≃-invariance) — the rules cannot see what the relation forgets ──────────────────
//
// "A rule applies at γ acting on n if and only if it applies at γ' acting on n, and the states
// the two applications reach are again related by ≃."
//
// Every premise reads control fields, declarations, or *domains* — never a bound value. So two
// instances whose bindings differ only in what no key distinguishes take the same rules in the same
// order. That is why the metatheory can be read up to ≃ at all.

func TestTwoInstancesRelatedByTheEquivalenceTakeTheSameRules(t *testing.T) {
	t.Parallel()

	// The same components, whose provisions bind different VALUES at the same keys.
	build := func(impl string) *effect.Registry {
		r := &effect.Registry{}
		var log []string
		insert(t, r, fiberCal, effect.Component{
			Provides: []string{seamCalendar},
			Effects: func(d effect.Deps) *effect.Iterator {
				return effect.Once(func() (effect.Dispose, error) {
					return d.Own.Set(seamCalendar, impl)
				})
			},
		})
		insert(t, r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))
		return r
	}
	google, fastmail := build("google"), build("fastmail")

	ruleSeqA, ruleSeqB := stepAll(google), stepAll(fastmail)

	require.NotEmpty(t, ruleSeqA, "the run took steps at all")
	require.Equal(t, ruleSeqA, ruleSeqB,
		"'no premise reads a value' — the lifecycle is driven by domains and control fields, so "+
			"swapping a supplier's implementation cannot change which rules fire or in what order")
}

// ── Lemma 61 (Equivariance) — names are atoms, and a renaming changes nothing ─────────────────
//
// "A premise reads a name only by comparing it with another… A bijection preserves each such
// comparison."
//
// So a fiber's name may be anything not already in use. The test is that two runs differing only in
// the names chosen take the same rules and reach corresponding states — which is also the licence
// Theorem 80 needs, since it compares states "after a renaming as in Lemma 61".

func TestRenamingEveryFiberChangesNothingButTheNames(t *testing.T) {
	t.Parallel()

	// Returns the RULE SEQUENCE, with each fiber named by its role rather than by its name —
	// which is what Lemma 61 is a claim about: "a sequence and its renaming take the same rules in
	// the same order". The component's own log is returned too, but it is the weaker of the two: it
	// records `provide:calendar` / `consume:up`, which mention no fiber name and would agree under
	// a renaming even if the rules had not. byRole — the rule sequence with each fiber named by
	// its ROLE rather than its name, which is the only way two differently-named runs can be
	// compared at all.
	byRole := func(taken []effect.Applied, booker effect.Name) []string {
		out := make([]string, 0, len(taken))
		for _, step := range taken {
			role := "provider"
			if step.Fiber == booker {
				role = "consumer"
			}
			out = append(out, string(step.Rule)+":"+role)
		}
		return out
	}

	build := func(cal, booker effect.Name) ([]string, []string) {
		r := &effect.Registry{}
		var log []string
		insert(t, r, cal, supplier(seamCalendar, &log))
		insert(t, r, booker, consumer(effect.Spec{seamCalendar}, &log))
		return byRole(stepAll(r), booker), log
	}

	rulesA, logA := build("cal", "booker")
	rulesB, logB := build("zzz-9f2a", "aaa-0001")

	require.NotEmpty(t, rulesA, "the run took steps at all")
	require.Equal(t, rulesA, rulesB,
		"names are atoms: 'no rule computes one, inspects its structure, or relates two of them "+
			"by anything but equality'. A name that sorted, or that encoded its component, would "+
			"make this fail and would make the load order depend on what things are called")
	require.Equal(t, logA, logB, "and the effects each fiber contributed agree as well")
}

// ── Lemma 62 (Vestigial entries) — an emptied entry is invisible to the rules ─────────────────
//
// "Call n vestigial at γ when τ_n = ⊤, θ_n = Inactive, σ_n = ∅, and no m has π_m = n; a
// vestigial entry satisfies γ ≃_K γ ∖ n."
//
// This is what lets Definition 52's inverse be an O-Retire rather than an O-Remove: the entry it
// leaves behind is indistinguishable from the fiber's absence, so leaving it is free.

func TestAnEmptiedRetiredEntryIsIndistinguishableFromItsAbsence(t *testing.T) {
	t.Parallel()
	keys := []string{seamCalendar, seamMail}
	var log []string

	// One registry keeps the vestigial entry; the other removes it.
	kept := &effect.Registry{}
	insert(t, kept, fiberCal, supplier(seamCalendar, &log))
	insert(t, kept, "ghost", supplier(seamIM, &log))
	settle(t, kept)
	retire(t, kept, "ghost")
	settle(t, kept) // now vestigial: retired, Inactive, empty table, no children

	removed := &effect.Registry{}
	insert(t, removed, fiberCal, supplier(seamCalendar, &log))
	insert(t, removed, "ghost", supplier(seamIM, &log))
	settle(t, removed)
	retire(t, removed, "ghost")
	settle(t, removed)
	require.NoError(t, removed.Remove("ghost"))

	// From here the two must behave identically under every subsequent rule.
	insert(t, kept, fiberMail, supplier(seamMail, &log))
	insert(t, removed, fiberMail, supplier(seamMail, &log))
	settle(t, kept)
	settle(t, removed)

	require.True(t, kept.Coeffects().Equivalent(removed.Coeffects(), keys),
		"γ ≃_K γ ∖ n: the entry that is left differs 'in control fields alone, and no rule "+
			"tells "+
			"the two apart'")
	require.True(t, kept.Independent(fiberCal, fiberMail),
		"and the vestigial entry is no obstacle to anything: it provides nothing, declares "+
			"nothing that resolves, and parents nobody")
}

// ── Lemma 75 — support is well founded, so there IS one answer ────────────────────────────────
//
// `⊲ := ≺ ∪ parent` is well founded whenever `≺` is acyclic, so Definition 74's recursion
// has exactly one solution. The proof's mechanism is worth a test: "a parent pointer names a fiber
// introduced earlier", so the parent half can never close a cycle on its own.

func TestSupportIsWellFoundedBecauseAParentIsAlwaysOlderThanItsChild(t *testing.T) {
	t.Parallel()
	var r effect.Registry
	var log []string

	insert(t, &r, "root-a", supplier(seamCalendar, &log))
	require.NoError(t, r.Insert("child-a", "root-a", consumer(effect.Spec{seamCalendar}, &log)))
	require.NoError(t, r.Insert("grandchild", "child-a", consumer(nil, &log)))

	require.ErrorIs(t, r.Insert("orphan", "not-yet-inserted", consumer(nil, &log)),
		effect.ErrUnknownParent,
		"O-Insert's second premise π ∈ dom(F_γ) ∪ {root} is what makes the parent half of "+
			"⊲ "+
			"descend in insertion index, and therefore what makes the recursion terminate")

	require.Empty(t, r.Cycles(), "≺ is acyclic here")
	require.ElementsMatch(t, []effect.Name{"root-a", "child-a", "grandchild"}, r.Support(),
		"so Definition 74 has one solution and Support can return it")
}
