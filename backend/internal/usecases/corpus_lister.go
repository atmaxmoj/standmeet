// corpus_lister.go —— #157: the slim corpus data port. Collapses the 3 fat genre
// listers (WikiLister/OutputLister/WritingLister, 12 methods, leaking postgres.WikiMeta
// + requiring callers to walk parents for path and filter by ACL after the fact) into
// ONE interface with 3 methods over unified value types.
//
// Three invariants the old shape violated:
//   - ACL is the method's job, IN the call (grantedGlobs in), not "scan all then the
//     caller filters". Search/List return only what the role may see.
//   - path is computed INSIDE the impl (tree-derived from parent + title slug); callers
//     get it on CorpusMeta.Path and never walk parents (no GetMetaByID exposed).
//   - genre is data on the row, not three parallel methods. One Search hits all genres.
//
// prod implements it over postgres (composing the genre repos + path + ACL); eval-harness
// implements it in-memory over the persona corpus — so retrieval needs no host socket.

package usecases

import "context"

// CorpusMeta —— one corpus entry's listing/search row. Path is tree-derived, filled by
// the impl. Snippet is search-only.
type CorpusMeta struct {
	ParentID    *string
	ID          string
	Path        string
	Title       string
	Genre       string // "wiki" | "output" | "writing"
	Snippet     string
	HasChildren bool
}

// CorpusEntry —— a full entry (read result): path + body.
type CorpusEntry struct {
	ID    string
	Path  string
	Title string
	Genre string
	Body  string
	Tags  []string
}

// CorpusLister —— the slim corpus data port (#157). Every method is ACL-scoped via
// grantedGlobs (the role's CorpusURIs patterns) and returns path-carrying rows; the impl
// owns path computation and ACL filtering. ErrCorpusDenied / ErrCorpusNotFound separate
// "you may not" from "no such path" on Get.
type CorpusLister interface {
	// Search —— full-text across all genres (first page), returning only entries the role
	// may see.
	Search(
		ctx context.Context, ownerID string, grantedGlobs []string, query string,
	) ([]CorpusMeta, error)
	// List —— children at parentPath ("" = roots), page 0-based, only those the role may see.
	List(
		ctx context.Context, ownerID string, grantedGlobs []string, parentPath string, page int,
	) ([]CorpusMeta, error)
	// Get —— full entry by path. ErrCorpusDenied if out of scope, ErrCorpusNotFound if
	// no such path.
	Get(
		ctx context.Context, ownerID string, grantedGlobs []string, path string,
	) (CorpusEntry, error)
}
