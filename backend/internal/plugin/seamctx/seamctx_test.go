package seamctx_test

// seamctx_test.go — the batch's test, written first. It pins the model the supplier-elimination
// wires onto: a per-owner seam context whose values are generic verb-invokers (string verb + JSON),
// NOT typed contracts. connect=Provide, seam-invoke=Resolve+CallVerb, disconnect=the dispose. No
// adapters, no Dispatcher, no Suppliers table, no active-column, no "calendar" type: the substrate
// sees only a seam name, a verb name, and JSON.

import (
	"context"
	"encoding/json"
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

// fakeProvider — a seam provider is just a verb-invoker (a block's tool-call shape). It echoes its
// id as the verb result, so a test can tell which provider answered.
type fakeProvider struct{ id string }

func (f fakeProvider) CallVerb(
	_ context.Context, _, _ string, _ json.RawMessage,
) (json.RawMessage, error) {
	b, err := json.Marshal(f.id)
	return b, err
}

func call(t *testing.T, p seamctx.Provider) string {
	t.Helper()
	out, err := p.CallVerb(context.Background(), owner1, "free_busy", nil)
	require.NoError(t, err)
	var got string
	require.NoError(t, json.Unmarshal(out, &got))
	return got
}

func TestResolveUnprovidedSeamMisses(t *testing.T) {
	t.Parallel()
	c := seamctx.New()
	_, ok := c.Resolve(owner1, calendar)
	require.False(t, ok, "a seam nobody provides for this owner must not resolve")
}

func TestProvideThenResolveThenRevoke(t *testing.T) {
	t.Parallel()
	c := seamctx.New()

	// provider block connects → provides itself for this owner's seam.
	dispose, err := c.Provide(owner1, calendar, fakeProvider{id: "google"})
	require.NoError(t, err)

	// seam-invoke resolves the owner's active provider and calls a verb by name — this IS dispatch.
	p, ok := c.Resolve(owner1, calendar)
	require.True(t, ok)
	require.Equal(t, "google", call(t, p))

	// disconnect → dispose → the seam no longer resolves (Def-29 check fails, nothing supervising).
	require.NoError(t, dispose())
	_, ok = c.Resolve(owner1, calendar)
	require.False(t, ok, "after dispose the seam must not resolve")
}

func TestOneActiveProviderPerOwnerSeam(t *testing.T) {
	t.Parallel()
	c := seamctx.New()
	_, err := c.Provide(owner1, calendar, fakeProvider{id: "google"})
	require.NoError(t, err)

	// a second provider of the same owner+seam is refused — activation is single, enforced by the
	// model, not by a hand-written "set the others inactive".
	_, err = c.Provide(owner1, calendar, fakeProvider{id: "caldav"})
	require.Error(t, err, "two providers must not co-occupy one owner's seam")
}

func TestOwnersAreIndependent(t *testing.T) {
	t.Parallel()
	c := seamctx.New()
	_, err := c.Provide(ownerA, calendar, fakeProvider{id: "caldav"})
	require.NoError(t, err)
	_, err = c.Provide(ownerB, calendar, fakeProvider{id: "google"})
	require.NoError(t, err)

	pa, ok := c.Resolve(ownerA, calendar)
	require.True(t, ok)
	require.Equal(t, "caldav", call(t, pa))

	pb, ok := c.Resolve(ownerB, calendar)
	require.True(t, ok)
	require.Equal(t, "google", call(t, pb), "owner B resolves the same seam to its own provider")
}
