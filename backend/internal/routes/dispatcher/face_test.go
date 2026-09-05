package dispatcher_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

func noop(context.Context, string, json.RawMessage) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

const (
	thingsList  = "things.list"
	thingsPaste = "things.paste"
)

func ownerOps() dispatcher.Resource {
	return dispatcher.Resource{Name: "things", Ops: []dispatcher.Op{
		{ID: thingsList, Kind: fp.Read, Reach: fp.OwnerRead(), Invoke: noop},
		{ID: "things.create", Kind: fp.Action, Reach: fp.OwnerAction(), Invoke: noop},
	}}
}

func face(name string) fp.Facade {
	return fp.Facade{Name: name, Plane: fp.PlaneOwner, ServesRead: true, ServesActn: true}
}

// TestGeneratedFaceIsCompleteByConstruction -- a generated face (MCP wires up exactly
// this way) pulls all ops at once, and pulling registers, so it can never owe anything.
// This is the "no hand-written step to forget" half.
func TestGeneratedFaceIsCompleteByConstruction(t *testing.T) {
	t.Parallel()

	d := dispatcher.New(ownerOps())
	d.Attach(face("mcp")).Ops()

	require.Empty(t, d.Conform())
}

// TestVerifiedFaceMissingAnOpIsCaught -- a verified face (admin HTTP) pulls capabilities
// one by one. Miss wiring one and it was never registered against the convergence point ->
// Conform reports missing.
//
// This is exactly what the hand-written ledger used to catch -- now structure catches it,
// nobody has to go add a row to a table.
func TestVerifiedFaceMissingAnOpIsCaught(t *testing.T) {
	t.Parallel()

	d := dispatcher.New(ownerOps())
	d.Attach(face("mcp")).Ops()
	admin := d.Attach(face("admin"))
	admin.MustOp(thingsList) // only list is wired, create is missed

	vs := d.Conform()
	require.Len(t, vs, 1)
	require.Equal(t, "admin", vs[0].Facade)
	require.Equal(t, "things.create", vs[0].OpID)
	require.Equal(t, "missing", vs[0].Kind)
}

// TestNewFaceInheritsTheWholeDebt -- when a new face is added, every op it owes is
// immediately listed. Nobody has to remember to update anything: Reach is the intent,
// and it settles automatically the moment a face registers.
func TestNewFaceInheritsTheWholeDebt(t *testing.T) {
	t.Parallel()

	d := dispatcher.New(ownerOps())
	d.Attach(face("mcp")).Ops()
	d.Attach(face("im")) // just attached, nothing wired yet

	vs := d.Conform()
	require.Len(t, vs, 2)
	for _, v := range vs {
		require.Equal(t, "im", v.Facade)
		require.Equal(t, "missing", v.Kind)
	}
}

// TestFaceAttachIsIdempotent -- it's normal for a face's routes to be wired across
// several files; Attaching the same name must return the same Face, otherwise
// registration would split in two and a phantom missing would get reported.
func TestFaceAttachIsIdempotent(t *testing.T) {
	t.Parallel()

	d := dispatcher.New(ownerOps())
	d.Attach(face("mcp")).Ops()
	d.Attach(face("admin")).MustOp(thingsList)
	d.Attach(face("admin")).MustOp("things.create")

	require.Empty(t, d.Conform())
}

// TestUnknownOpPanicsAtWireTime -- a misspelled id must blow up while wiring the route,
// not silently drop a route at runtime.
func TestUnknownOpPanicsAtWireTime(t *testing.T) {
	t.Parallel()

	d := dispatcher.New(ownerOps())
	admin := d.Attach(face("admin"))
	require.Panics(t, func() { admin.MustOp("things.nope") })
}

// TestDuplicateOpIDPanics -- two ops sharing a name means one of them can never be
// reached. That can only blow up at startup.
func TestDuplicateOpIDPanics(t *testing.T) {
	t.Parallel()

	require.Panics(t, func() { dispatcher.New(ownerOps(), ownerOps()) })
}

// TestDecoratorWrapsEveryFaceAlike -- decorators hang on the convergence point, so every
// capability a face gets has already passed through the same chain. Bypassing it means
// bypassing the convergence point -- and that path is blocked by a structural gate.
func TestDecoratorWrapsEveryFaceAlike(t *testing.T) {
	t.Parallel()

	seen := []string{}
	d := dispatcher.New(ownerOps()).With(
		func(op *dispatcher.Op, next dispatcher.Invoke) dispatcher.Invoke {
			id := op.ID
			return func(
				ctx context.Context, ownerID string, in json.RawMessage,
			) (json.RawMessage, error) {
				seen = append(seen, id)
				return next(ctx, ownerID, in)
			}
		},
	)

	mcpOps := d.Attach(face("mcp")).Ops()
	_, err := mcpOps[0].Invoke(context.Background(), "o1", nil)
	require.NoError(t, err)

	adminOp := d.Attach(face("admin")).MustOp(thingsList)
	_, err = adminOp.Invoke(context.Background(), "o1", nil)
	require.NoError(t, err)

	require.Equal(t, []string{thingsList, thingsList}, seen)
}

// TestGeneratedFaceDoesNotServeWhatItIsNotOwed -- a generated face only grows the ops
// **it's supposed to serve**.
//
// This guards a real defect that once occurred: Face.Ops() originally returned every op
// in the convergence point, so an op explicitly marked Only(reason, "admin")
// (marketplace.install_manual) grew onto MCP anyway -- Reach degraded to a comment, and
// "generated" turned into "whatever the convergence point holds gets exposed", exactly
// the most dangerous default.
//
// Remove the filter here and this test goes red.
func TestGeneratedFaceDoesNotServeWhatItIsNotOwed(t *testing.T) {
	t.Parallel()

	adminOnly := dispatcher.Resource{Name: "things", Ops: []dispatcher.Op{
		{ID: thingsList, Kind: fp.Read, Reach: fp.OwnerRead(), Invoke: noop},
		{
			ID: thingsPaste, Kind: fp.Action, Invoke: noop,
			Reach: fp.Only("browser-only affordance", "admin"),
		},
	}}
	d := dispatcher.New(adminOnly)

	mcp := d.Attach(face("mcp"))
	served := mcp.Ops()
	got := make([]string, 0, len(served))
	for _, op := range served {
		got = append(got, op.ID)
	}
	require.Equal(t, []string{thingsList}, got,
		"the generated face must not serve an op pinned to another face")

	// admin genuinely owes it -- only once it's wired do both faces reconcile.
	admin := d.Attach(face("admin"))
	admin.MustOp(thingsList)
	admin.MustOp(thingsPaste)
	require.Empty(t, d.Conform())
}
