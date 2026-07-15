// corpus_map.go —— the adaptive corpus skeleton (corpus_map op).
//
// Why this exists: a full node listing grows linearly with the vault and, at AI-era writing
// rates, outruns any context budget within months (any budget is exhausted by a long enough
// list — the same doctrine as the turn boundary). The skeleton instead is near-constant: it
// shows the high-level node tree with per-subtree counts, and DEPTH is a RESULT of a token
// budget, not a parameter — the densest subtrees (most hidden nodes = most unresolved entropy)
// are expanded first, sparse ones stay collapsed. Mirrors what a strong agent actually
// consumes (it reads hubs top-down and never touches most leaves).
//
// Protocol note: in this corpus an internal node IS a note (parent_id tree, derived path), so
// every tree node carries a title and is itself corpus_read-able — no folder/file split, no
// hub-note convention. The map's rows are nodes, not directories.

package usecases

import (
	"slices"
	"strings"
)

// CorpusMapEntry —— one visible node the map is built from: its derived path + title. The
// lister supplies the ACL-filtered set; the tree/budget shaping is pure (below).
type CorpusMapEntry struct {
	Path  string
	Title string
}

// MapNode —— one node in the rendered skeleton. Count is the subtree size INCLUDING self;
// Children is non-nil only where the budget expanded it; Truncated marks an internal node
// left collapsed (the agent can corpus_map(under=path) or corpus_list to drill it).
type MapNode struct {
	Path      string    `json:"path"`
	Title     string    `json:"title"`
	Children  []MapNode `json:"children,omitempty"`
	Count     int       `json:"count"`
	Truncated bool      `json:"truncated,omitempty"`
}

const (
	// defaultMapBudget —— nodes rendered when the caller doesn't pass one. ~a screenful; keeps
	// the skeleton near-constant regardless of vault size.
	defaultMapBudget = 40
	maxMapBudget     = 200
	minMapBudget     = 5
)

// mapTreeNode —— internal build node (a real corpus node: has a title + children + subtree count).
type mapTreeNode struct {
	children map[string]*mapTreeNode
	path     string
	title    string
	count    int // subtree size including self
	expanded bool
}

// BuildCorpusMap —— shape the ACL-filtered node set into a budget-bounded skeleton rooted at
// `under` ("" = whole corpus). Pure: no DB, no ACL (caller pre-filtered). budget is a node
// count; depth emerges from expanding the densest subtrees first.
func BuildCorpusMap(entries []CorpusMapEntry, under string, budget int) []MapNode {
	budget = clampBudget(budget)
	root := buildPathTree(entries)
	start := descendTo(root, under)
	if start == nil {
		return []MapNode{}
	}
	tops := sortedChildren(start)
	spent := len(tops)
	expandByDensity(tops, &spent, budget)
	return renderNodes(tops)
}

func clampBudget(b int) int {
	if b <= 0 {
		return defaultMapBudget
	}
	if b < minMapBudget {
		return minMapBudget
	}
	if b > maxMapBudget {
		return maxMapBudget
	}
	return b
}

// buildPathTree —— entries → a path-prefix tree. Every prefix is a real node in this protocol
// (derived path), so intermediate nodes get their title from the matching entry; a title only
// missing if an ancestor wasn't in the visible set (ACL) — then it shows its path segment.
func buildPathTree(entries []CorpusMapEntry) *mapTreeNode {
	root := newMapNode("")
	titles := map[string]string{}
	for i := range entries {
		titles[entries[i].Path] = entries[i].Title
	}
	for i := range entries {
		segs := strings.Split(entries[i].Path, "/")
		cur := root
		for j := range segs {
			p := strings.Join(segs[:j+1], "/")
			nxt, ok := cur.children[segs[j]]
			if !ok {
				nxt = newMapNode(p)
				nxt.title = titleOr(titles[p], segs[j])
				cur.children[segs[j]] = nxt
			}
			cur = nxt
		}
	}
	computeCounts(root)
	return root
}

func newMapNode(path string) *mapTreeNode {
	return &mapTreeNode{path: path, children: map[string]*mapTreeNode{}}
}

func titleOr(title, seg string) string {
	if strings.TrimSpace(title) != "" {
		return title
	}
	return seg
}

// computeCounts —— post-order subtree size (including self for non-root nodes).
func computeCounts(n *mapTreeNode) int {
	total := 0
	if n.path != "" {
		total = 1
	}
	for _, c := range n.children {
		total += computeCounts(c)
	}
	n.count = total
	return total
}

// descendTo —— the node at `under` ("" = root). nil if the path isn't in the visible tree.
func descendTo(root *mapTreeNode, under string) *mapTreeNode {
	under = strings.Trim(under, "/")
	if under == "" {
		return root
	}
	cur := root
	for seg := range strings.SplitSeq(under, "/") {
		nxt, ok := cur.children[seg]
		if !ok {
			return nil
		}
		cur = nxt
	}
	return cur
}

// expandByDensity —— greedy: repeatedly expand the collapsed internal node hiding the MOST
// nodes, spending one budget unit per revealed child, until the budget runs out. Depth is
// whatever this produces — dense subtrees deepen, sparse ones stay flat.
func expandByDensity(tops []*mapTreeNode, spent *int, budget int) {
	frontier := append([]*mapTreeNode{}, tops...)
	for *spent < budget {
		best := pickDensest(frontier)
		if best == nil {
			return
		}
		best.expanded = true
		kids := sortedChildren(best)
		*spent += len(kids)
		frontier = replaceInFrontier(frontier, best, kids)
	}
}

// pickDensest —— the not-yet-expanded internal node with the largest subtree (most hidden).
func pickDensest(frontier []*mapTreeNode) *mapTreeNode {
	var best *mapTreeNode
	for _, n := range frontier {
		if expandable(n) && (best == nil || n.count > best.count) {
			best = n
		}
	}
	return best
}

func expandable(n *mapTreeNode) bool {
	return !n.expanded && len(n.children) > 0
}

func replaceInFrontier(
	frontier []*mapTreeNode, done *mapTreeNode, kids []*mapTreeNode,
) []*mapTreeNode {
	out := make([]*mapTreeNode, 0, len(frontier)+len(kids))
	for _, n := range frontier {
		if n != done {
			out = append(out, n)
		}
	}
	return append(out, kids...)
}

func sortedChildren(n *mapTreeNode) []*mapTreeNode {
	out := make([]*mapTreeNode, 0, len(n.children))
	for _, c := range n.children {
		out = append(out, c)
	}
	// densest first, then alphabetical — stable, and puts the big subtrees on top.
	slices.SortFunc(out, func(a, b *mapTreeNode) int {
		if a.count != b.count {
			return b.count - a.count
		}
		return strings.Compare(a.path, b.path)
	})
	return out
}

func renderNodes(nodes []*mapTreeNode) []MapNode {
	out := make([]MapNode, 0, len(nodes))
	for _, n := range nodes {
		mn := MapNode{Path: n.path, Title: n.title, Count: n.count}
		if n.expanded {
			mn.Children = renderNodes(sortedChildren(n))
		} else if len(n.children) > 0 {
			mn.Truncated = true
		}
		out = append(out, mn)
	}
	return out
}
