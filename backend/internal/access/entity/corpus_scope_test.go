// corpus_scope_test.go — the corpus kind of the three ACL kinds: what an identity can read +
// what a code takes back.
//
// This is gate 1's algebra — one mistake here is a leak, so it is pinned down clause by
// clause: pure subtraction, order-independent, a code cannot open what its role never
// granted. **The public-identity branch lives here too**: it ignores glob, it looks at the
// entry's own published flag (F-D-7).

package entity_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/stretchr/testify/require"
)

// These URIs repeat below (every case needs one "granted" and one "taken back"); pulled into
// constants.
const (
	globWikiAll   = "wiki://**"
	globSubjAll   = "subjectivity://**"
	uriCV         = "subjectivity://cv"
	uriStandpoint = "subjectivity://standpoint"
	globWikiPriv  = "wiki://private/**"
)

// In the invited-identity cases published is **irrelevant** (the owner deliberately granted
// this entry), so unpublished is passed uniformly — making "a glob grant ignores publish
// state" visible on every line.
const (
	unpublished = false
	published   = true
)

// allows — reads "scope + this entry" as one line, so every assertion need not spell out
// a struct literal.
func allows(scope entity.CorpusScope, uri string, isPublished bool) bool {
	return entity.AllowsCorpusEntry(scope, entity.CorpusEntryRef{URI: uri, Published: isPublished})
}

// TestAllowsCorpusEntry_CodeNarrowsRole — real motivation: a role grants all of subjectivity
// (all stances should be given), but a particular code should not see the record note
// (CV: real name / education / employer). The owner takes back `subjectivity://cv` on that code.
func TestAllowsCorpusEntry_CodeNarrowsRole(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{
		Granted: []string{globWikiAll, globSubjAll},
		Denied:  []string{uriCV},
	}
	require.False(t, allows(scope, uriCV, unpublished),
		"the code took this one back — it must not be readable")
	require.True(t, allows(scope, uriStandpoint, unpublished),
		"the rest of the grant is untouched")
	require.True(t, allows(scope, "wiki://math/logic", unpublished),
		"other genres are untouched")
}

// TestAllowsCorpusEntry_DenyCannotOpen — the other half of pure subtraction, also A.4's iron
// rule: a code can only subtract. A glob in the deny list does not become readable just by
// being "mentioned"; whatever the role never granted stays unreadable.
func TestAllowsCorpusEntry_DenyCannotOpen(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{
		Granted: []string{globWikiAll},
		Denied:  []string{uriCV},
	}
	require.False(t, allows(scope, uriStandpoint, unpublished),
		"role never granted subjectivity — mentioning a subjectivity glob in DENY opens nothing")
}

// TestAllowsCorpusEntry_OrderIndependent — A.2 originally deferred corpus-level narrowing,
// citing "order-sensitive, first-match-wins". That described a design where deny lines are
// mixed into one glob list. Two independent lists = set intersection, **ordering does not
// change the result** — this test is the proof that reasoning no longer holds.
func TestAllowsCorpusEntry_OrderIndependent(t *testing.T) {
	t.Parallel()
	const uri = uriCV
	a := entity.CorpusScope{
		Granted: []string{globSubjAll, globWikiAll},
		Denied:  []string{uriCV, globWikiPriv},
	}
	b := entity.CorpusScope{ // both lists written in reverse order
		Granted: []string{globWikiAll, globSubjAll},
		Denied:  []string{globWikiPriv, uriCV},
	}
	require.Equal(t,
		allows(a, uri, unpublished),
		allows(b, uri, unpublished),
		"reordering either list must not change the verdict — set intersection, not first-match")
	require.False(t, allows(a, uri, unpublished))
}

// TestAllowsCorpusEntry_DenyGlobTakesSubtree — deny speaks the same language as grant (glob,
// not note id): one `subjectivity://**` takes the whole genre back from this code; writing
// entries one by one also works.
func TestAllowsCorpusEntry_DenyGlobTakesSubtree(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{
		Granted: []string{globWikiAll},
		Denied:  []string{globWikiPriv},
	}
	require.False(t, allows(scope, "wiki://private/salary", unpublished))
	require.False(t, allows(scope, "wiki://private/deep/nested", unpublished))
	require.True(t, allows(scope, "wiki://public/thing", unpublished))
}

// TestAllowsCorpusEntry_EmptyDenyIsInheritance — no deny configured = full inheritance from
// role (backward compat: an existing code with zero deny lines must behave identically).
func TestAllowsCorpusEntry_EmptyDenyIsInheritance(t *testing.T) {
	t.Parallel()
	granted := []string{globWikiAll, globSubjAll}
	for _, denied := range [][]string{nil, {}} {
		scope := entity.CorpusScope{Granted: granted, Denied: denied}
		require.True(t, allows(scope, uriCV, unpublished),
			"no denials → the role's grant stands unchanged")
	}
}

// TestAllowsCorpusEntry_RawStillHardDenied — raw://** is a hardcoded deny, writing it into
// grant does not open it. The deny layer must not shake this existing floor.
func TestAllowsCorpusEntry_RawStillHardDenied(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{Granted: []string{"raw://**", globWikiAll}}
	require.False(t, allows(scope, "raw://anything", unpublished),
		"raw is denied to visitors regardless of the grant list")
}

// TestAllowsCorpusEntry_PublicReadsOnlyPublished — **F-D-7's algebra**.
//
// The public identity (no-code visitor + BYOAI) has no positive list: whether an entry is
// readable comes down to its own publish state. It used to carry `wiki://**`, which let
// notes marked PRIVATE be read anyway — that glob was a second copy of the same fact, and
// nobody notices when the wrong one of two copies goes stale.
func TestAllowsCorpusEntry_PublicReadsOnlyPublished(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{PublishedOnly: true}
	require.True(t, allows(scope, "wiki://open/note", published),
		"the owner published this one — a stranger may read it")
	require.False(t, allows(scope, "wiki://held/back", unpublished),
		"private with no code is unreadable — that is the whole rule")
	require.False(t, allows(scope, "raw://anything", published),
		"raw stays denied on this branch too")
}

// TestAllowsCorpusEntry_PublicIgnoresAStaleGrantList — an old instance's role_corpus_uris
// still has those three glob rows sitting in it (seed only runs at claim time). They
// **must not** let public read unpublished material anymore: the verdict comes from
// identity, not from whatever is left in that table.
func TestAllowsCorpusEntry_PublicIgnoresAStaleGrantList(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{
		Granted:       []string{globWikiAll, "output://**", "writing://**"},
		PublishedOnly: true,
	}
	require.False(t, allows(scope, "wiki://held/back", unpublished),
		"a leftover wiki://** row must not reopen what the owner never published")
}

// TestAllowsCorpusEntry_PublicStillObeysCodeDenials — the public identity also goes through
// the deny half: an auto-issued application code is assigned public, and whatever the owner
// takes back on that code must still be taken back.
func TestAllowsCorpusEntry_PublicStillObeysCodeDenials(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{
		Denied:        []string{globWikiPriv},
		PublishedOnly: true,
	}
	require.True(t, allows(scope, "wiki://open/note", published))
	require.False(t, allows(scope, "wiki://private/pay", published),
		"published, but this code took the subtree back")
}

// TestAllowsCorpusEntry_InvitedReadsUnpublished — the reverse direction needs pinning too,
// otherwise a lazy "treat everything as published" implementation would also pass the
// cases above: the **invited** identity can read unpublished notes — that is the whole
// point of issuing a code.
func TestAllowsCorpusEntry_InvitedReadsUnpublished(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{Granted: []string{globWikiAll}}
	require.True(t, allows(scope, "wiki://held/back", unpublished),
		"the owner invited this visitor on purpose — publishing is not what gates them")
}
