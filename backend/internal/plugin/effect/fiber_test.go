// fiber_test.go —— §4.1 and §4.2: the objects and the nine rules. Red by design.
//
// The running example is the one this repo actually has: a `calendar` supplier, a `mail` supplier,
// and a `booker` block that declares both. That is the shape the user named — "book 就需要
// calendar 和 mail" — and it is enough to exercise every rule, because the interesting cases are
// all about a consumer and its providers arriving and leaving in an order nobody chose.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// supplier —— a component providing one key, whose activation installs it and whose inverse
// removes it. `log` records the order in which things actually happened, which is what most of
// these tests are really about.
func supplier(key string, log *[]string) effect.Component {
	return effect.Component{
		Provides: []string{key},
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				*log = append(*log, "provide:"+key)
				undo, err := d.Own.Set(key, key+"-impl")
				if err != nil {
					return nil, err
				}
				return func() error {
					*log = append(*log, "withdraw:"+key)
					return undo()
				}, nil
			})
		},
	}
}

// consumer —— a component declaring keys and providing none. Its teardown **reads a key it
// declared**, which is the case §4.2.2 separates L-Leave from L-Unload for: "closing a connection
// pool typically means handing the connections back to whatever provided them".
func consumer(requires effect.Spec, log *[]string) effect.Component {
	return effect.Component{
		Requires: requires,
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				*log = append(*log, "consume:up")
				return func() error {
					if err := readEach(d, requires); err != nil {
						return err
					}
					*log = append(*log, "consume:down")
					return nil
				}, nil
			})
		},
	}
}

// readEach —— touch every declared key. If one is already gone the guard released early, which
// is the failure §4.2.2's L-Leave/L-Unload split exists to prevent.
func readEach(d effect.Deps, requires effect.Spec) error {
	for _, k := range requires {
		if _, _, err := d.Use(k, observe); err != nil {
			return err
		}
	}
	return nil
}

// observe —— read a bound value without changing it: the simplest operation of any key.
func observe(v any) effect.Outcome {
	return effect.Outcome{Value: v, Defined: true}
}

// ── O-Insert — the fourth premise is the single-source discipline ──────────────────────────────

func TestInsertRefusesASecondDeclarantOfOneKey(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, "cal-google", supplier(seamCalendar, &log))
	err := r.Insert("cal-fastmail", effect.Root, supplier(seamCalendar, &log))

	require.ErrorIs(t, err, effect.ErrProvisionOverlap,
		"O-Insert's fourth premise: a key has one possible provider because the orchestrator may "+
			"not admit a second component DECLARING it — refused before either runs, not "+
			"discovered when two writes collide")
}

// ── O-Insert starts nothing ────────────────────────────────────────────────────────────────────

func TestInsertStartsNothing(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))

	f, ok := r.Get(fiberCal)
	require.True(t, ok)
	require.Equal(t, effect.PhaseInactive, f.Phase)
	require.Empty(t, log, "O-Insert writes an entry; no effect of the component has run")
}

// ── Theorem 70 / L-Begin — there is no load order to arrange ───────────────────────────────────
//
// The consumer is inserted FIRST, before anything provides what it declares. Nothing starts it; it
// starts when its premises hold. An implementation that needs the providers inserted first is a
// topological sort wearing the calculus as a costume.

func TestAConsumerInsertedFirstActivatesWhenItsProvidersArrive(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar, seamMail}, &log))
	settle(t, &r)

	f, _ := r.Get(fiberBooker)
	require.Equal(t, effect.PhaseInactive, f.Phase,
		"target is ⊥ while γ ⊭ d: Definition 53. Waiting, and not an error")
	require.Empty(t, log)

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	settle(t, &r)
	f, _ = r.Get(fiberBooker)
	require.Equal(t, effect.PhaseInactive, f.Phase, "one of two dependencies is not γ ⊨ d")

	insert(t, &r, fiberMail, supplier(seamMail, &log))
	settle(t, &r)

	f, _ = r.Get(fiberBooker)
	require.Equal(t, effect.PhaseActive, f.Phase,
		"L-Begin fires unprompted the moment target_n ≠ ⊥ — no rule of the calculus STARTS a "+
			"fiber")
	require.Equal(t, []string{"provide:calendar", "provide:mail", "consume:up"}, log,
		"the order is derived from the declarations, not from the insertion order")
}

// ── O-Retire is unconditional; O-Remove is not ─────────────────────────────────────────────────

func TestRetireIsUnconditionalAndRemoveWaitsForTheSystemToPutThingsBack(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, fiberCal, supplier(seamCalendar, &log))
	settle(t, &r)

	require.NoError(t, r.Retire(fiberCal), "O-Retire has one premise: the fiber exists")
	f, _ := r.Get(fiberCal)
	require.True(t, f.Retired)
	require.Equal(t, effect.PhaseActive, f.Phase,
		"retiring is a REQUEST; the lifecycle carries it out")

	require.ErrorIs(t, r.Remove(fiberCal), effect.ErrNotRemovable,
		"O-Remove's premises θ = Inactive ∧ σ = ∅ are unmet. Removing here 'would discard "+
			"the "+
			"accumulator and leak' — which is what a DELETE FROM installed_blocks does")

	settle(t, &r)
	require.NoError(t, r.Remove(fiberCal),
		"now Inactive with an empty table: the removal discards none")
	_, ok := r.Get(fiberCal)
	require.False(t, ok)
}

func TestRemoveTakesChildrenBeforeTheirParent(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, "group", consumer(nil, &log))
	require.NoError(t, r.Insert("member", "group", consumer(nil, &log)))
	settle(t, &r)
	retire(t, &r, "group")
	retire(t, &r, "member")
	settle(t, &r)

	require.ErrorIs(t, r.Remove("group"), effect.ErrNotRemovable,
		"∀m. π_m ≠ n keeps the tree well formed by removing children before their parent")
	require.NoError(t, r.Remove("member"))
	require.NoError(t, r.Remove("group"))
}

// ── Definition 52 — an instantiated child is RETIRED by its parent's inverse, never removed
// ────
//
// Because "an inverse has to apply wherever it is reached", and O-Remove carries premises that can
// fail. This is the one place the paper picks the weaker operation on purpose, and picking the
// stronger one is the natural mistake: a parent that removed its children would be tidier and would
// deadlock the first time a child was still Active.

func TestAParentsInverseRetiresItsChildRatherThanRemovingIt(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	host := effect.Component{
		Effects: func(d effect.Deps) *effect.Iterator {
			return effect.Once(func() (effect.Dispose, error) {
				inst, err := r.Instantiate("host", supplier(seamMail, &log))
				return inst.Undo, err
			})
		},
	}
	insert(t, &r, "host", host)
	settle(t, &r)
	require.Len(t, r.Names(), 2, "the activation instantiated one child")

	retire(t, &r, "host")
	settle(t, &r)

	names := r.Names()
	require.Len(t, names, 2,
		"the child's ENTRY survives: Def 52's inverse is an O-Retire, and the vestigial entry it "+
			"leaves 'differs from the absence of the fiber in control fields alone'. An inverse "+
			"built from O-Remove could fail to apply, and an inverse that can fail is not one")
	for _, n := range names {
		f, _ := r.Get(n)
		require.True(t, f.Retired)
		require.Equal(t, effect.PhaseInactive, f.Phase)
	}
}

// ── Definition 53 — the view records the PROVIDER, so an equal value from a different fiber
// is a change
// ──────────────────────────────────────────────────────────────────────────────────────
//
// "Recording a provider rather than a value is what makes the comparison usable, since a different
// fiber providing an equal value would otherwise compare equal." The same claim `Scope.Epoch` makes
// for one scope, here as the type of ω.

func TestSwappingTheProviderReloadsTheConsumerEvenForAnEqualValue(t *testing.T) {
	t.Parallel()
	var log []string
	var r effect.Registry

	insert(t, &r, "cal-a", supplier(seamCalendar, &log))
	insert(t, &r, fiberBooker, consumer(effect.Spec{seamCalendar}, &log))
	settle(t, &r)

	f, _ := r.Get(fiberBooker)
	require.Equal(t, effect.View{"calendar": "cal-a"}, f.Committed)

	// Retire A and insert B, which provides the same key with the same value. Disjointness of
	// provisions is why this is a swap and not two providers.
	retire(t, &r, "cal-a")
	settle(t, &r)
	require.NoError(t, r.Remove("cal-a"))
	log = nil
	insert(t, &r, "cal-b", supplier(seamCalendar, &log))
	settle(t, &r)

	f, _ = r.Get(fiberBooker)
	require.Equal(t, effect.PhaseActive, f.Phase)
	require.Equal(t, effect.View{"calendar": "cal-b"}, f.Committed,
		"the consumer re-activated against the new provider. A boolean 'is calendar provided' "+
			"would have been true throughout and nothing would have reloaded")
}
