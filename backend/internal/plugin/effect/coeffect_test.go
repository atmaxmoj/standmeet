// coeffect_test.go —— §3.2 of arXiv:2608.25512, reactive coeffects. **Red by design.**
//
// The running example is the one this product actually has: **`calendar.book` needs `calendar` and
// `mail`.** Nobody wires it to `google-calendar`. The booker declares `requires: [calendar, mail]`,
// a supplier declares `provides: calendar`, and the runtime matches them **by key name alone** —
// which is the whole content of `σ ⊨ d := ∀k ∈ d. k ∈ dom(σ)`.
//
// That matching is not the interesting part, though; our manifests already do it. What these tests
// are for is the half we do not have: **classifying every change to σ against d** (Definition 22)
// so that a supplier arriving activates exactly the components that were waiting for it, and a
// supplier leaving deactivates exactly those, rather than the whole set being recomputed and the
// difference being invisible.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// booker —— the specification of `calendar.book`, as its manifest declares it.
var booker = effect.Spec{seamCalendar, seamMail}

// ── Definition 21/22 — satisfaction is ALL the declared keys, not any ──────────────────────

func TestPartialSatisfactionDoesNotSatisfy(t *testing.T) {
	t.Parallel()
	var seams effect.Table

	require.False(t, seams.Satisfied(booker), "nothing bound → book cannot run")

	_, err := seams.Set(seamCalendar, implGoogleCal)
	require.NoError(t, err)
	require.False(t, seams.Satisfied(booker),
		"a calendar but no mailer: book must NOT be exposed. Half a coeffect is the case where a "+
			"visitor is offered a booking that cannot confirm itself")

	_, err = seams.Set(seamMail, "smtp")
	require.NoError(t, err)
	require.True(t, seams.Satisfied(booker), "both declared keys bound → satisfied")
}

// ── Definition 22 — the three classifications drive activation ─────────────────────────────

func TestBindingTheLastMissingKeyIsActivating(t *testing.T) {
	t.Parallel()
	var seams effect.Table
	_, err := seams.Set(seamCalendar, implGoogleCal)
	require.NoError(t, err)

	got := seams.Notify(booker, func() {
		_, undo := seams.Set(seamMail, "smtp")
		require.NoError(t, undo)
	})
	require.Equal(t, effect.Activating, got,
		"σ ⊭ d ∧ σ' ⊨ d — and an activating transition is what triggers the component's "+
			"effects")
}

func TestWithdrawingARequiredKeyIsDeactivating(t *testing.T) {
	t.Parallel()
	var seams effect.Table
	_, err := seams.Set(seamCalendar, implGoogleCal)
	require.NoError(t, err)
	releaseMail, err := seams.Set(seamMail, "smtp")
	require.NoError(t, err)

	got := seams.Notify(booker, func() { require.NoError(t, releaseMail()) })
	require.Equal(t, effect.Deactivating, got,
		"σ ⊨ d ∧ σ' ⊭ d — and a deactivating transition triggers recovery by applying "+
			"the "+
			"component's accumulator")
}

func TestAnUnrelatedKeyIsNeutral(t *testing.T) {
	t.Parallel()
	var seams effect.Table
	_, err := seams.Set(seamCalendar, implGoogleCal)
	require.NoError(t, err)
	_, err = seams.Set(seamMail, "smtp")
	require.NoError(t, err)

	got := seams.Notify(booker, func() {
		_, setErr := seams.Set(seamStorage, "s3")
		require.NoError(t, setErr)
	})
	require.Equal(t, effect.Neutral, got,
		"a key book never declared must not disturb it — this is what stops one supplier's "+
			"arrival "+
			"from reloading everything in the instance")
}

// ── Definition 20 — set IS an effect: it hands back the inverse that withdraws the binding
// ──

func TestProvidingADependencyReturnsItsOwnWithdrawal(t *testing.T) {
	t.Parallel()
	var seams effect.Table

	release, err := seams.Set(seamCalendar, implGoogleCal)
	require.NoError(t, err)
	require.True(t, seams.Satisfied(effect.Spec{seamCalendar}))

	require.NoError(t, release())
	require.False(t, seams.Satisfied(effect.Spec{seamCalendar}),
		"set returns λσ'. σ' \\ k — so a supplier going away needs no supervisor: its own "+
			"accumulator already holds the withdrawal")

	_, err = seams.Get(seamCalendar)
	require.ErrorIs(t, err, effect.ErrNotBound)
}

// ── Definition 20's precondition — k ∉ dom(σ), and a violation produces NO transition ──────
//
// This is `plugin.NewResolver` refusing two suppliers of one seam, stated as the law it implements.
// The "no transition" half matters as much as the refusal: were it last-wins, every dependent of
// `calendar` would be told a different provider arrived, and Definition 44 says a single-binding
// key does not commute, so there is no order in which that is safe.

func TestASecondProviderOfOneSeamIsRefusedAndChangesNothing(t *testing.T) {
	t.Parallel()
	var seams effect.Table
	_, err := seams.Set(seamCalendar, implGoogleCal)
	require.NoError(t, err)

	_, err = seams.Set(seamCalendar, "caldav")
	require.ErrorIs(t, err, effect.ErrAlreadyBound)

	v, err := seams.Get(seamCalendar)
	require.NoError(t, err)
	require.Equal(t, implGoogleCal, v,
		"a violated precondition produces no transition: the incumbent is untouched, and no "+
			"dependent was ever told anything changed")
}

func TestSwappingASupplierIsWithdrawThenProvide(t *testing.T) {
	t.Parallel()
	var seams effect.Table
	release, err := seams.Set(seamCalendar, implGoogleCal)
	require.NoError(t, err)

	require.NoError(t, release())
	_, err = seams.Set(seamCalendar, "caldav")
	require.NoError(t, err,
		"a swap is not a third operation: it is the incumbent's inverse followed by a fresh "+
			"provision, which is why the dependents see a deactivate and then an activate rather "+
			"than silently continuing against a different provider")

	v, err := seams.Get(seamCalendar)
	require.NoError(t, err)
	require.Equal(t, "caldav", v)
}

// ── Definition 24 — isolation is DERIVED: no inverse, nothing to track ─────────────────────

func TestIsolationDerivesAContextAndWritesNothingShared(t *testing.T) {
	t.Parallel()
	var shared effect.Table
	_, err := shared.Set(seamCalendar, implGoogleCal)
	require.NoError(t, err)

	perVisitor := shared.Isolate("calendar", "visitor-42")
	_, err = perVisitor.Set(seamCalendar, "caldav")
	require.NoError(t, err, "a different realm is a different binding, not a second claim on one")

	v, err := shared.Get(seamCalendar)
	require.NoError(t, err)
	require.Equal(t, implGoogleCal, v,
		"Def 23: isolation is a derived realization — it leaves the input intact, so nothing in "+
			"the shared table changed and there is no effect to revert")

	v, err = perVisitor.Get(seamCalendar)
	require.NoError(t, err)
	require.Equal(t, "caldav", v, "the same key resolves differently under the derived context")
}

// ── Definition 26/27 — interception constrains a component without modifying it ────────────

type denyList struct{ denied []string }

// the interface. Returning denyList would make two providers' metadata uncombinable.
//
//nolint:ireturn // Def 27: a metadata monoid composes across providers, so ⊕ is typed at
func (d denyList) Merge(other effect.Meta) effect.Meta {
	o, ok := other.(denyList)
	if !ok {
		return d
	}
	return denyList{denied: append(append([]string{}, d.denied...), o.denied...)}
}
func (d denyList) Empty() bool { return len(d.denied) == 0 }

func TestInterceptionConstrainsWithoutTouchingTheComponent(t *testing.T) {
	t.Parallel()
	var shared effect.Table
	_, err := shared.Set("corpus", "full")
	require.NoError(t, err)

	restricted := shared.Intercept("corpus", denyList{denied: []string{"wiki://private/**"}})

	v, err := restricted.Get("corpus")
	require.NoError(t, err)
	require.NotEqual(t, "full", v,
		"the enclosing context's metadata is merged into the access, right-biased — which is how "+
			"an access code's deny-list constrains what a block reaches WITHOUT editing the block")

	v, err = shared.Get("corpus")
	require.NoError(t, err)
	require.Equal(t, "full", v, "and derived, so the shared table is untouched for everyone else")
}

func TestInterceptionMetadataIsAMonoid(t *testing.T) {
	t.Parallel()
	a := denyList{denied: []string{keyA}}
	b := denyList{denied: []string{keyB}}
	c := denyList{denied: []string{keyC}}

	require.Equal(t, a.Merge(b).Merge(c), a.Merge(b.Merge(c)),
		"Def 27 requires ⊕_k associative: nesting two contexts that each constrain one key must "+
			"give one constraint, independent of how the nesting was bracketed")
	require.True(t, denyList{}.Empty(), "ε_k")
}
