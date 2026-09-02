// corpus_tree_path.go —— a document's address = the path computed from its position in the
// parent tree, each segment being a slugified title. One concept, one word: path.
//
// Not stored on the document, not backed by a nullable column: corpus is a filesystem, and a
// file's path comes from which directory it's in. root (no parent / parent not in the set) =
// itself as a single segment; has parent = parent's path + '/' + its own segment. Always
// non-empty, always addressable, no orphan documents exist. The retriever (visitor chat) and
// citation lookup (dialog) both compute path this same way, so the convention stays consistent.

package usecase

import (
	"strconv"
	"strings"
	"unicode"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

// TreeMaxDepth —— guards against cycles / abnormally deep trees.
const TreeMaxDepth = 32

// pathSegmentMaxLen —— per-segment truncation length, expressive enough without going
// unbounded (unit: characters).
const pathSegmentMaxLen = 80

// pathNode —— computing path only needs id / title / parent. Wiki and Output are two
// isomorphic trees; each folds down to pathNode and shares one computation.
type pathNode struct {
	id        string
	title     string
	parentID  string
	hasParent bool
}

// WikiTreePaths / OutputTreePaths —— computes an id→tree-path address table for a set of
// documents belonging to the same owner (see treePathsFor). The retriever reporting addresses
// (search/read/ACL), citation lookup, the public landing page, and admin browsing all query
// this same table — one derived-from-the-tree convention, no stored column.
func WikiTreePaths(ws []entity.Wiki) map[string]string {
	nodes := make([]pathNode, len(ws))
	for i := range ws {
		pid, ok := ws[i].ParentID()
		nodes[i] = pathNode{id: ws[i].ID(), title: ws[i].Title(), parentID: pid, hasParent: ok}
	}
	return treePathsFor(nodes)
}

// OutputTreePaths —— the output twin of WikiTreePaths (same tree-derived convention).
func OutputTreePaths(os []entity.Output) map[string]string {
	nodes := make([]pathNode, len(os))
	for i := range os {
		pid, ok := os[i].ParentID()
		nodes[i] = pathNode{id: os[i].ID(), title: os[i].Title(), parentID: pid, hasParent: ok}
	}
	return treePathsFor(nodes)
}

// RawTreePaths —— the raw twin of WikiTreePaths: raw is now a genre='raw' node in
// corpus_notes, using the same tree-derived convention (parent chain + slug(title)).
// The admin /raw list uses this to compute each row's address.
func RawTreePaths(rs []entity.Raw) map[string]string {
	nodes := make([]pathNode, len(rs))
	for i := range rs {
		pid, ok := rs[i].ParentID()
		nodes[i] = pathNode{id: rs[i].ID(), title: rs[i].Title(), parentID: pid, hasParent: ok}
	}
	return treePathsFor(nodes)
}

// WikiMetaTreePaths / OutputMetaTreePaths —— the same tree-derived convention, but taking
// meta (no body). landing/sitemap uses the full meta set (ListAllMeta, no 50-cap) to compute
// path, without needing to load the full body.
func WikiMetaTreePaths(metas []repo.WikiMeta) map[string]string {
	return treePathsFor(wikiMetaNodes(metas))
}

// OutputMetaTreePaths —— the output twin of WikiMetaTreePaths.
func OutputMetaTreePaths(metas []repo.OutputMeta) map[string]string {
	nodes := make([]pathNode, len(metas))
	for i := range metas {
		nodes[i] = metaNode(metas[i].ID, metas[i].Title, metas[i].ParentID)
	}
	return treePathsFor(nodes)
}

func wikiMetaNodes(metas []repo.WikiMeta) []pathNode {
	nodes := make([]pathNode, len(metas))
	for i := range metas {
		nodes[i] = metaNode(metas[i].ID, metas[i].Title, metas[i].ParentID)
	}
	return nodes
}

func metaNode(id, title string, parentID *string) pathNode {
	if parentID == nil {
		return pathNode{id: id, title: title, hasParent: false}
	}
	return pathNode{id: id, title: title, parentID: *parentID, hasParent: true}
}

// treePathsFor —— path = the slugified title of every segment from root to this node,
// joined with '/'. A path collision (same slug under the same parent) gets deduped by
// appending -2/-3 in order of appearance (seen is only used during construction, to
// guarantee path→id is injective). Returns id→path.
func treePathsFor(nodes []pathNode) map[string]string {
	byNodeID := make(map[string]pathNode, len(nodes))
	for _, n := range nodes {
		byNodeID[n.id] = n
	}
	byID := make(map[string]string, len(nodes))
	seen := make(map[string]string, len(nodes))
	for _, n := range nodes {
		p := uniquePath(computePath(n, byNodeID), seen)
		byID[n.id] = p
		seen[p] = n.id
	}
	return byID
}

// computePath —— walks the parent chain (bounded to this set) to build the root→self path.
// If parent isn't in the set (deleted / cut off by ACL), treat this node as root and start
// the path from here.
func computePath(n pathNode, byID map[string]pathNode) string {
	segs := make([]string, 0, TreeMaxDepth)
	cur := n
	for range TreeMaxDepth {
		segs = append([]string{PathSegment(cur.title)}, segs...)
		if !cur.hasParent {
			break
		}
		parent, in := byID[cur.parentID]
		if !in {
			break
		}
		cur = parent
	}
	return strings.Join(segs, "/")
}

// uniquePath —— use base if it's free, otherwise base-2 / base-3 …
// until a free slot is found.
func uniquePath(base string, taken map[string]string) string {
	if _, used := taken[base]; !used {
		return base
	}
	for i := 2; ; i++ {
		candidate := base + "-" + strconv.Itoa(i)
		if _, used := taken[candidate]; !used {
			return candidate
		}
	}
}

// SlugifyTitle —— the exported wrapper for PathSegment. Used by eval fixtures when computing
// the authorized URI for a corpus entry, kept aligned with the retriever's
// WikiPathByID/OutputPathByID (a flat fixture with no parent → a single PathSegment(title)
// segment), so a grant using the old uri-path and the retriever's title-derived path don't
// mismatch and reject everything under ACL.
func SlugifyTitle(title string) string { return PathSegment(title) }

// PathSegment —— converts a title into a URL-safe path segment: lowercase; letters/digits
// (including unicode, since the citext path column can hold it) count as words, everything
// else counts as a separator → FieldsFunc splits words + joins with '-' (automatically trims
// the ends / collapses consecutive separators). Truncated to pathSegmentMaxLen. Empty (a
// title of pure symbols) falls back to "untitled".
func PathSegment(title string) string {
	words := strings.FieldsFunc(strings.ToLower(title), isPathSeparator)
	out := strings.Join(words, "-")
	// Cut by character, and **leave no ellipsis** — this segment goes into an address. Cutting
	// by byte would split a CJK title mid-character at byte 80, and postgres rejects the whole
	// row when that gets written into the citext path column.
	out = strings.Trim(textcut.Runes(out, pathSegmentMaxLen), "-")
	if out == "" {
		return "untitled"
	}
	return out
}

// isPathSeparator —— anything that's not a letter or digit counts as a separator within a
// path segment.
func isPathSeparator(r rune) bool {
	return !unicode.IsLetter(r) && !unicode.IsNumber(r)
}
