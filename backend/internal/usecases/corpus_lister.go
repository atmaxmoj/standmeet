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

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

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
	ID         string
	Path       string
	Title      string
	Genre      string
	Body       string
	Tags       []string
	CSSClasses []string // cssclasses frontmatter(per-note 呈现钩子)
	// ShowAsSource —— wiki/output only: false = AI 能 read 拿 body，但 readCollector
	// 不把它收进 cited(meta/persona 类)。见 collectCitation 的 gate。
	ShowAsSource bool
}

// CorpusLister —— the slim corpus data port (#157). Every method is ACL-scoped via
// grantedGlobs (the role's CorpusURIs patterns) and returns path-carrying rows; the impl
// owns path computation and ACL filtering. ErrCorpusDenied / ErrCorpusNotFound separate
// "you may not" from "no such path" on Get.
type CorpusLister interface {
	// Search —— full-text across all genres (first page), returning only entries the role
	// may see.
	Search(
		ctx context.Context, ownerID string, scope domain.CorpusScope, query string,
	) ([]CorpusMeta, error)
	// List —— children at parentPath ("" = roots), page 0-based, only those the role may see.
	List(
		ctx context.Context, ownerID string, scope domain.CorpusScope, parentPath string, page int,
	) ([]CorpusMeta, error)
	// Get —— full entry by path. ErrCorpusDenied if out of scope, ErrCorpusNotFound if
	// no such path.
	Get(
		ctx context.Context, ownerID string, scope domain.CorpusScope, path string,
	) (CorpusEntry, error)
	// Links —— 1 跳 backlinks:本条的 outgoing links + backlinks 邻居(顺 note_refs)。每个邻居
	// 逐条过 grantedGlobs ACL(防经链接侧漏);主体本身走 Get 的准入(denied/not-found 同语义)。
	Links(
		ctx context.Context, ownerID string, scope domain.CorpusScope, path string,
	) (CorpusLinks, error)
	// MapEntries —— every visible wiki node as {path,title} (ACL-filtered). The tree/budget
	// shaping into a skeleton is pure (BuildCorpusMap), so the lister only enumerates.
	MapEntries(
		ctx context.Context, ownerID string, scope domain.CorpusScope,
	) ([]CorpusMapEntry, error)
	// Resolve —— a bare name (a [[wikilink]] target, title, or slug) → the matching node(s),
	// so the agent navigates by name instead of guessing a path from a snippet.
	Resolve(
		ctx context.Context, ownerID string, scope domain.CorpusScope, name string,
	) ([]CorpusMeta, error)
}

// CorpusLinks —— corpus_links 的返回:分开 outgoing(本条引用的)/ backlinks(引用本条的)。
type CorpusLinks struct {
	Outgoing  []CorpusMeta
	Backlinks []CorpusMeta
}
