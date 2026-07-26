package usecases

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/stretchr/testify/require"
)

// TestResolveNoteDstIDs_ProximitySameGenre —— F-L-10: the real vault mirrors its topic tree across
// wiki/ and raw/, so hub basenames (logic, math, theory, …) exist in BOTH genres. A [[X]] must
// resolve to the SAME-GENRE sibling (Obsidian proximity), not last-write-wins to the raw draft. RED
// on the old flat title→id map: the raw candidate listed last wins, so every hub note's backlinks
// point at the raw draft and the curated note's backlinks panel goes empty.
func TestResolveNoteDstIDs_ProximitySameGenre(t *testing.T) {
	t.Parallel()
	titles := []corpus.OwnerNoteTitleRow{
		{ID: "wiki-logic", Title: "logic", Genre: "wiki"},
		{ID: "src", Title: "chomsky-hierarchy", Genre: "wiki"},
		{ID: "raw-logic", Title: "logic", Genre: "raw"}, // LAST → old map resolved here (the bug)
	}
	dst := resolveNoteDstIDs("prereq: [[logic]] for the hierarchy", titles, "src")
	require.Equal(t, []string{"wiki-logic"}, dst,
		"a wiki note's [[logic]] must resolve to the wiki sibling, not the raw draft")
}

// TestResolveNoteDstIDs_FallsBackAcrossGenre —— no same-genre candidate → still resolve to the
// first non-self candidate, so a genuine cross-genre link (wiki → output) is not dropped.
func TestResolveNoteDstIDs_FallsBackAcrossGenre(t *testing.T) {
	t.Parallel()
	titles := []corpus.OwnerNoteTitleRow{
		{ID: "src", Title: "wiki-note", Genre: "wiki"},
		{ID: "out-thing", Title: "thing", Genre: "output"},
	}
	dst := resolveNoteDstIDs("see [[thing]]", titles, "src")
	require.Equal(t, []string{"out-thing"}, dst)
}

// TestResolveNoteDstIDs_SkipsSelfLink —— a note linking its own basename resolves to a different-
// genre sibling (not itself); a pure self-link drops.
func TestResolveNoteDstIDs_SkipsSelfLink(t *testing.T) {
	t.Parallel()
	titles := []corpus.OwnerNoteTitleRow{
		{ID: "raw-math", Title: "math", Genre: "raw"},
		{ID: "wiki-math", Title: "math", Genre: "wiki"},
	}
	// source raw-math links [[math]] → same-genre candidate is itself → skip → wiki sibling.
	dst := resolveNoteDstIDs("[[math]]", titles, "raw-math")
	require.Equal(t, []string{"wiki-math"}, dst)
}

// TestWikiMetaPathTitleIndex_IncludesGated —— F-L-12: the [[X]] render index must include GATED
// (unpublished) entries, not just published. The real instance is all-gated (published=0), so a
// published-only index went empty and RewriteWikiCrossLinksForRender left every [[link]] as dead
// literal text. RED on the old `if meta.Published` filter: a gated target is dropped → its [[link]]
// never resolves.
func TestWikiMetaPathTitleIndex_IncludesGated(t *testing.T) {
	t.Parallel()
	parent := "p"
	metas := []corpus.WikiMeta{
		{ID: "p", Title: "Cybernetics", Published: false},
		{ID: "c", Title: "Theory", Published: false, ParentID: &parent},
	}
	paths := WikiMetaTreePaths(metas)
	idx := wikiMetaPathTitleIndex(metas, paths)
	require.Len(t, idx, 2, "both gated entries must be in the render index (F-L-12)")

	body := RewriteWikiCrossLinksForRender("See [[Theory]] for more.", idx)
	require.Contains(t, body, "[Theory](/wiki/"+paths["c"]+")",
		"a [[link]] to a gated target must rewrite to an anchor (RestrictedDoc handoff on click)")
	require.NotContains(t, body, "[[Theory]]", "no literal [[…]] may survive")
}
