package effect_test

// seam_as_coeffect_test.go — the UNIFIED MODEL, pinned as a test so the old adapters machine
// (adapters.Dispatcher / Suppliers / the Supplier interface) cannot drag the design back.
//
// The claim, in one line: a "supplier" is not a thing. A seam (calendar, mail, …) is a COEFFECT KEY
// in the owner's context Σ (effect.Table). A provider block, as its EFFECT, PROVIDES a value at
// that key (Table.Set). A consumer block, via its COEFFECT, INJECTS it (Table.Get) and calls — the
// call IS the dispatch. "Connected/active" = the provision is present; "disconnected/revoked" is
// Def-29's failing check: the provision is disposed, the key leaves Σ, every consumer's coeffect
// goes unsatisfied — with no Dispatcher, no Suppliers table, no Supplier interface in the path.
//
// Nothing here imports internal/plugin/adapters. If this still passes after that machine is gone,
// the machine was redundant with ctx all along — the whole point.

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// calendarSeam — the contract of the value at the "calendar" coeffect key. All that survives of
// "CalendarProxy": the TYPE of a seam's value, owned by the coeffect, not by a supplier.
type calendarSeam interface {
	FreeBusy(ownerID string) []string
}

type fakeCalendar struct{ busy []string }

func (f fakeCalendar) FreeBusy(string) []string { return f.busy }

const calendar = "calendar"

func provide(t *testing.T, ctx *effect.Table, busy string) effect.Dispose {
	t.Helper()
	d, err := ctx.Set(calendar, calendarSeam(fakeCalendar{busy: []string{busy}}))
	require.NoError(t, err)
	return d
}

// TestSeamProvideInjectRevoke — the full life of a seam, expressed only through ctx.
func TestSeamProvideInjectRevoke(t *testing.T) {
	t.Parallel()
	ctx := &effect.Table{} // the owner's Σ

	// Before any provider block, the booker's `calendar` coeffect is unsatisfied and injecting
	// yields nothing — the tool is simply not offered.
	require.False(t, ctx.Satisfied(effect.Spec{calendar}), "no provider: must be unsatisfied")
	_, err := ctx.Get(calendar)
	require.ErrorIs(t, err, effect.ErrNotBound, "inject with no provider must fail")

	// A calendar block's EFFECT provides the seam value — what "connecting a supplier" becomes.
	revoke := provide(t, ctx, "09:00-10:00")

	// The consumer INJECTS by seam name and calls: this is the entire dispatch (Get + call), with
	// no adapters.Dispatcher, no Suppliers.Lookup, no active-column read.
	require.True(t, ctx.Satisfied(effect.Spec{calendar}), "provider present: must be satisfied")
	v, err := ctx.Get(calendar)
	require.NoError(t, err)
	cal, ok := v.(calendarSeam)
	require.Truef(t, ok, "seam value must satisfy the calendar contract, got %T", v)
	require.Equal(t, []string{"09:00-10:00"}, cal.FreeBusy("owner1"), "dispatch through ctx")

	// Def-29 check fails (disconnect / oauth revoked): dispose the provision → the key leaves Σ →
	// the consumer's coeffect is unsatisfied again. The tool disappears, nothing supervising it.
	require.NoError(t, revoke())
	require.False(t, ctx.Satisfied(effect.Spec{calendar}), "after revoke: unsatisfied")
	_, err = ctx.Get(calendar)
	require.ErrorIs(t, err, effect.ErrNotBound, "after revoke: inject must fail")
}

// TestSeamActiveProviderIsSingleBinding — "which provider is active" needs no active-column and no
// arbitration table: a seam key holds exactly one binding (k ∉ dom(σ) refuses a second), so
// activation is re-provision — dispose the current, provide the next.
func TestSeamActiveProviderIsSingleBinding(t *testing.T) {
	t.Parallel()
	ctx := &effect.Table{}

	revokeGoogle := provide(t, ctx, "google") // Google is the active calendar provider.

	// A second provider (CalDAV) of the SAME seam cannot co-bind — one active provider, enforced by
	// the model, not by a hand-written "set the others inactive" SQL.
	_, err := ctx.Set(calendar, calendarSeam(fakeCalendar{busy: []string{"caldav"}}))
	require.Error(t, err, "two providers must not co-bind one seam; activation is single")

	// Activating CalDAV = deactivating Google (dispose) then providing CalDAV.
	require.NoError(t, revokeGoogle())
	provide(t, ctx, "caldav")

	v, err := ctx.Get(calendar)
	require.NoError(t, err)
	cal, ok := v.(calendarSeam)
	require.True(t, ok)
	require.Equal(t, []string{"caldav"}, cal.FreeBusy("owner1"), "active after swap")
}

// TestSeamActivationIsReactive — a consumer need not poll: the transition into/out of satisfaction
// is observable at the effect boundary (Def-22), which is how "the tool appears when the owner
// connects a provider, disappears when they disconnect" falls out of the model, not from wiring.
func TestSeamActivationIsReactive(t *testing.T) {
	t.Parallel()
	ctx := &effect.Table{}
	spec := effect.Spec{calendar}

	var revoke effect.Dispose
	act := ctx.Notify(spec, func() { revoke = provide(t, ctx, "x") })
	require.Equal(t, effect.Activating, act, "providing an unmet seam is Activating")

	deact := ctx.Notify(spec, func() { require.NoError(t, revoke()) })
	require.Equal(t, effect.Deactivating, deact, "revoking the last provider is Deactivating")
}
