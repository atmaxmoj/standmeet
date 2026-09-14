package seamctx_test

// seamctx_test.go — the batch's test, written first. It specifies the foundational 零件 the
// supplier-elimination wires onto: a per-owner seam context. It is the model
// (effect/seam_as_coeffect_test.go) made into the small API the live path uses —
// connect → Provide, seam-invoke → Resolve, disconnect → the dispose. No adapters, no Dispatcher,
// no Suppliers table, no active-column: those are what this replaces.

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/seamctx"
)

const (
	owner1   = "owner1"
	ownerA   = "ownerA"
	ownerB   = "ownerB"
	calendar = "calendar"
)

// a stand-in seam value: what a provider provides at a seam key has methods the consumer calls.
type calSvc interface{ FreeBusy() string }

type fakeCal struct{ id string }

func (f fakeCal) FreeBusy() string { return f.id }

func TestResolveUnprovidedSeamMisses(t *testing.T) {
	t.Parallel()
	c := seamctx.New()
	_, ok := c.Resolve(owner1, calendar)
	require.False(t, ok, "a seam nobody provides for this owner must not resolve")
}

func TestProvideThenResolveThenRevoke(t *testing.T) {
	t.Parallel()
	c := seamctx.New()

	// provider block connects → provides its seam value for this owner.
	dispose, err := c.Provide(owner1, calendar, calSvc(fakeCal{id: "google"}))
	require.NoError(t, err)

	// seam-invoke resolves the owner's active provider and calls it — this IS the dispatch.
	v, ok := c.Resolve(owner1, calendar)
	require.True(t, ok)
	cal, ok := v.(calSvc)
	require.True(t, ok)
	require.Equal(t, "google", cal.FreeBusy())

	// disconnect → dispose → the seam no longer resolves (Def-29 check fails, nothing supervising).
	require.NoError(t, dispose())
	_, ok = c.Resolve(owner1, calendar)
	require.False(t, ok, "after dispose the seam must not resolve")
}

func TestOneActiveProviderPerOwnerSeam(t *testing.T) {
	t.Parallel()
	c := seamctx.New()
	_, err := c.Provide(owner1, calendar, calSvc(fakeCal{id: "google"}))
	require.NoError(t, err)

	// a second provider of the same owner+seam is refused — activation is single, enforced by the
	// model, not by a hand-written "set the others inactive".
	_, err = c.Provide(owner1, calendar, calSvc(fakeCal{id: "caldav"}))
	require.Error(t, err, "two providers must not co-occupy one owner's seam")
}

func TestOwnersAreIndependent(t *testing.T) {
	t.Parallel()
	c := seamctx.New()
	_, err := c.Provide(ownerA, calendar, calSvc(fakeCal{id: "caldav"}))
	require.NoError(t, err)
	_, err = c.Provide(ownerB, calendar, calSvc(fakeCal{id: "google"}))
	require.NoError(t, err)

	va, ok := c.Resolve(ownerA, calendar)
	require.True(t, ok)
	ca, ok := va.(calSvc)
	require.True(t, ok)
	require.Equal(t, "caldav", ca.FreeBusy())

	vb, ok := c.Resolve(ownerB, calendar)
	require.True(t, ok)
	cb, ok := vb.(calSvc)
	require.True(t, ok)
	require.Equal(t, "google", cb.FreeBusy(), "owner B resolves the same seam to its own provider")
}
