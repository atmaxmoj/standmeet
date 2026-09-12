package blockwire

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
	"github.com/atmaxmoj/standmeet/internal/plugin"
)

// The owner's blocks table must be derived from the manifests, not from a list of the blocks
// somebody remembered. These are the two properties that the hand-written version failed, and
// they are written against the declarations rather than against names, so a block added
// tomorrow is covered without touching this file.

// TestEverySuppliedSeamGetsARow —— one row per seam a shipped supplier declares. No exceptions.
//
// RED on the version this replaced: that one returned two rows, written out by hand, while four
// built-in blocks declare `provides`. `telegram` (im) and `bearer-api` (api) ship in the same
// image and could never reach the owner's table — a shipped supplier with no way to be seen.
func TestEverySuppliedSeamGetsARow(t *testing.T) {
	t.Parallel()

	want := map[string]bool{}
	for _, m := range BuiltinManifests() {
		if m.Provides != "" {
			want[m.Provides] = false
		}
	}
	require.NotEmpty(t, want, "no built-in supplier declares a seam — the test lost its subject")

	// The row builder reads facts.seams, and facts.seams is built from seamTitles(), so
	// asserting the rows alone leaves the derivation itself untested: dropping one supplier
	// inside seamTitles() stayed green until this went in.
	titles := seamTitles()
	require.Len(t, titles, len(want), "seamTitles() dropped a seam some shipped supplier declares")
	for seam := range want {
		require.NotEmpty(t, titles[seam], "seam %q is supplied but has no name to show", seam)
	}

	rows := supplierSlotRows(&blockFacts{seams: want})
	require.Len(t, rows, len(want))

	for i := range rows {
		require.Equal(t, "supplier", rows[i].Kind)
		require.False(t, rows[i].Deletable, "a seam slot is disconnected, never deleted")
		require.NotEmpty(t, rows[i].Title, "row %q has no name to render", rows[i].ID)
		require.Contains(t, want, rows[i].ID[len(supplierRowPrefix):])
	}
}

// TestDependencyNamesTheSeamsSupplier —— a block that requires a seam gets a dependency naming
// the thing the owner has to go and connect, and one that requires nothing gets none.
//
// The claim is about the WIRING, so it is driven with manifests written here rather than with a
// shipped block: reading a shipped block's `requires` would make this test agree with whatever
// that manifest happens to say today. RED on the version this replaced, which answered from a
// two-case switch on the block id and returned nil for everything else.
func TestDependencyNamesTheSeamsSupplier(t *testing.T) {
	t.Parallel()

	facts := &blockFacts{seams: map[string]bool{"calendar": false}}

	got := pickDependency([]string{"calendar"}, facts)
	require.NotNil(t, got, "a declared, supplied seam must produce a dependency")
	require.Equal(t, seamLabel("calendar"), got.Name)
	require.False(t, got.Connected)

	facts.seams["calendar"] = true
	require.True(t, pickDependency([]string{"calendar"}, facts).Connected)

	require.Nil(t, pickDependency(nil, facts), "declares nothing → no dependency")
	require.Nil(t, pickDependency([]string{"nobody-supplies-this"}, facts),
		"a seam nothing in this image supplies gives the owner nothing to connect")
}

// TestUnmetSeamWinsOverMet —— the row exists to tell the owner what is missing, so when a block
// declares several seams the unmet one is the one named, whatever order it was declared in.
func TestUnmetSeamWinsOverMet(t *testing.T) {
	t.Parallel()

	facts := &blockFacts{seams: map[string]bool{"calendar": true, "mail": false}}
	require.Equal(t, seamLabel("mail"), pickDependency([]string{"calendar", "mail"}, facts).Name)
	require.Equal(t, seamLabel("mail"), pickDependency([]string{"mail", "calendar"}, facts).Name)
}

// TestAPICandidatesAreTheBlocksDeclaringRenderableTools —— the block-grain list is the
// tool-grain list, read through the manifests.
//
// It does NOT go red on the hand-typed `{"corpus.retrieval", "calendar.book"}` this replaced —
// that literal was correct on the day it was written, which is exactly how a copied list gets
// to look fine. What this catches is the drift: the two sides disagreeing after a tool moves,
// in both directions, since every candidate must declare a renderable tool and every block
// declaring one must be a candidate. Catching the hardcoding itself is the guard's job
// (infra/scripts/check-host-blind-to-blocks.sh), not this test's.
func TestAPICandidatesAreTheBlocksDeclaringRenderableTools(t *testing.T) {
	t.Parallel()

	candidates := APICandidateBlocks()
	require.NotEmpty(t, candidates, "no block may be opened to the api facade — check the wiring")

	renderable := paritymanifest.APIRenderableTools()
	inList := map[string]bool{}
	for _, id := range candidates {
		inList[id] = true
	}
	for _, m := range BlockManifests() {
		want := declaresAnyOf(&m, renderable)
		require.Equal(t, want, inList[m.ID],
			"block %q: candidate=%v, declares a renderable tool=%v", m.ID, inList[m.ID], want)
	}
}

// declaresAnyOf — does this block declare a visitor tool from the given set.
func declaresAnyOf(m *plugin.Manifest, tools []string) bool {
	return slices.ContainsFunc(plugin.VisitorToolNames(m.VisitorTools), func(name string) bool {
		return slices.Contains(tools, name)
	})
}
