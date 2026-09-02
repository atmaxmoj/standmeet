// writing_tree_context.go — the context of one writing: its ancestor chain (breadcrumb) +
// direct children (sub-rail / the article page's tree frame). Uses the same rules as the
// writing tree (published + locked markers), located by slug. The reader's article-page SSR
// uses this to draw the breadcrumb.

package usecase

import "github.com/atmaxmoj/standmeet/internal/corpus/entity"

// WritingContext — a node's context. Ancestors is in root→parent order (excluding self).
type WritingContext struct {
	Ancestors []WritingTreeNode
	Children  []WritingTreeNode
}

// WritingNodeContext — the ancestor chain + direct children of the entry matching slug in the
// published list. slug not in the published set → empty context.
func WritingNodeContext(writings []entity.Writing, slug string) WritingContext {
	empty := WritingContext{Ancestors: []WritingTreeNode{}, Children: []WritingTreeNode{}}
	idx, found := writingIndexAtSlug(writings, slug)
	if !found {
		return empty
	}
	present := writingIDSet(writings)
	return WritingContext{
		Ancestors: writingAncestorsOf(writings, present, idx),
		Children:  WritingTreeChildren(writings, writings[idx].ID()),
	}
}

// writingIndexAtSlug — the index of the entry matching slug.
func writingIndexAtSlug(writings []entity.Writing, slug string) (int, bool) {
	for i := range writings {
		if writings[i].Slug() == slug {
			return i, true
		}
	}
	return 0, false
}

// writingAncestorsOf — walks up the effective-parent chain collecting ancestors, ordered
// root→parent.
func writingAncestorsOf(
	writings []entity.Writing, present map[string]bool, idx int,
) []WritingTreeNode {
	byID := writingIndexByID(writings)
	chain := make([]WritingTreeNode, 0)
	cur := &writings[idx]
	for range TreeMaxDepth {
		pid := writingEffectiveParent(cur, present)
		parentIdx, in := byID[pid]
		if pid == "" || !in {
			break
		}
		parent := &writings[parentIdx]
		chain = append([]WritingTreeNode{writingNode(parent, map[string]bool{})}, chain...)
		cur = parent
	}
	return chain
}

// writingIndexByID — id → index.
func writingIndexByID(writings []entity.Writing) map[string]int {
	out := make(map[string]int, len(writings))
	for i := range writings {
		out[writings[i].ID()] = i
	}
	return out
}
