// corpus_lister.go —— #157: the slim corpus data port. Collapses the 3 fat genre
// listers (Wiki/Output/WritingLister, 12 methods, leaking WikiMeta
// + requiring callers to walk parents for path and filter by ACL after the fact) into
// ONE interface with 3 methods over unified value types.
//
// Three invariants the old shape violated:
//   - ACL is the method's job, IN the call (grantedGlobs in), not "scan all then the
//     caller filters". Search/List return only what the role may see.
//   - path is computed INSIDE the impl (tree-derived from parent + title slug); callers
//     get it on Meta.Path and never walk parents (no GetMetaByID exposed).
//   - genre is data on the row, not three parallel methods. One Search hits all genres.
//
// prod implements it over postgres (composing the genre repos + path + ACL); eval-harness
// implements it in-memory over the persona corpus — so retrieval needs no host socket.

package usecase

import (
	"context"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// Meta —— one corpus entry's listing/search row. Path is tree-derived, filled by
// the impl. Snippet is search-only.
type Meta struct {
	ParentID    *string
	ID          string
	Path        string
	Title       string
	Genre       string // "wiki" | "output" | "writing"
	Snippet     string
	HasChildren bool
}

// Entry —— a full entry (read result): path + body.
type Entry struct {
	ID   string
	Path string
	// Slug —— writings only. **On the public site a writing is addressed by slug**
	// (`/writings/<slug>`), while Path is its position in the tree (`writings/<slug>`,
	// carrying the vault directory layer). The two are not the same, and without this
	// separate field a caller has only Path to build the address from — on prod that builds
	// `/writing/writings/the-business-model-wedge`, a 404.
	// wiki / output are addressed by Path; this field is empty for them.
	Slug       string
	Title      string
	Genre      string
	Body       string
	Tags       []string
	CSSClasses []string // cssclasses frontmatter (per-note rendering hook)
	// ShowAsSource —— wiki/output only: false = the AI can read and get the body, but
	// readCollector won't fold it into cited (the meta/persona category). See the gate in
	// collectCitation.
	ShowAsSource bool
	// Published —— this note's own public switch (the one the owner toggles per-entry in
	// /admin). Whether the public identity (uninvited visitors + BYOAI) can read it comes
	// down to this one value — so every finder must carry it forward, rather than letting
	// ACL judge off a zero value (F-D-7).
	Published bool
}

// Lister —— the slim corpus data port (#157). Every method is ACL-scoped via
// grantedGlobs (the role's CorpusURIs patterns) and returns path-carrying rows; the impl
// owns path computation and ACL filtering. ErrCorpusDenied / ErrCorpusNotFound separate
// "you may not" from "no such path" on Get.
type Lister interface {
	// Search —— full-text across all genres (first page), returning only entries the role
	// may see.
	Search(
		ctx context.Context, ownerID string, scope access.CorpusScope, query string,
	) ([]Meta, error)
	// List —— children at parentPath ("" = roots), page 0-based, only those the role may see.
	List(
		ctx context.Context, ownerID string, scope access.CorpusScope, parentPath string, page int,
	) ([]Meta, error)
	// Get —— full entry by path. ErrCorpusDenied if out of scope, ErrCorpusNotFound if
	// no such path.
	Get(
		ctx context.Context, ownerID string, scope access.CorpusScope, path string,
	) (Entry, error)
	// Links —— 1-hop backlinks: this entry's outgoing links + backlink neighbors (via
	// note_refs). Each neighbor is checked against grantedGlobs ACL individually (guards
	// against leaking through a link); the subject itself goes through Get's own admission
	// (same denied/not-found semantics).
	Links(
		ctx context.Context, ownerID string, scope access.CorpusScope, path string,
	) (Links, error)
	// MapEntries —— every visible wiki node as {path,title} (ACL-filtered). The tree/budget
	// shaping into a skeleton is pure (BuildCorpusMap), so the lister only enumerates.
	MapEntries(
		ctx context.Context, ownerID string, scope access.CorpusScope,
	) ([]MapEntry, error)
	// Resolve —— a bare name (a [[wikilink]] target, title, or slug) → the matching node(s),
	// so the agent navigates by name instead of guessing a path from a snippet.
	Resolve(
		ctx context.Context, ownerID string, scope access.CorpusScope, name string,
	) ([]Meta, error)
	// Grep —— every place a pattern occurs, under the same scope. Not a ranking: if the pattern
	// is in a readable note, that note is in the result. Whoever implements Lister must be able
	// to answer this, or "never-miss" would hold only on the implementations that felt like it.
	Grep(
		ctx context.Context, ownerID string, scope access.CorpusScope, req *GrepRequest,
	) ([]GrepHit, error)
}

// Links —— corpus_links's return: split into outgoing (what this entry references) /
// backlinks (what references this entry).
type Links struct {
	Outgoing  []Meta
	Backlinks []Meta
}
