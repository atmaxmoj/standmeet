// writing_tree.go —— lazy-loaded layering of the writing tree for the reader sidebar. Shares
// its shape with the wiki tree (nodesUnder/effectiveParent), but ACL rules differ:
//   - Visibility = published (drafts don't enter the public tree). The input is already a
//     published list → everything in it is visible.
//   - private (visibility != public) **still shows in the tree**, marked Locked (the design
//     calls for showing locked nodes in italic) — the opposite of wiki's "don't leak gated
//     titles".
//   - Navigation is by slug (writing landing is /writings/<slug>), unlike wiki which uses
//     tree-path.

package usecase

import "github.com/atmaxmoj/standmeet/internal/corpus/entity"

// WritingTreeNode —— one node at one level of the tree. Locked = private (teaser only).
type WritingTreeNode struct {
	ID          string
	Title       string
	Slug        string
	HasChildren bool
	Locked      bool
}

// WritingTreeChildren —— the direct children of parentID within the published list
// (parentID="" → roots). If parent isn't in the published set (draft/deleted), its
// children get promoted to root.
func WritingTreeChildren(writings []entity.Writing, parentID string) []WritingTreeNode {
	present := writingIDSet(writings)
	hasKids := writingParentsWithChild(writings, present)
	out := make([]WritingTreeNode, 0)
	for i := range writings {
		if writingEffectiveParent(&writings[i], present) == parentID {
			out = append(out, writingNode(&writings[i], hasKids))
		}
	}
	return out
}

func writingNode(w *entity.Writing, hasKids map[string]bool) WritingTreeNode {
	return WritingTreeNode{
		ID: w.ID(), Title: w.Title(), Slug: w.Slug(),
		HasChildren: hasKids[w.ID()], Locked: !w.Visibility().IsPublic(),
	}
}

// writingIDSet —— the ids within the published set.
func writingIDSet(writings []entity.Writing) map[string]bool {
	out := make(map[string]bool, len(writings))
	for i := range writings {
		out[writings[i].ID()] = true
	}
	return out
}

// writingEffectiveParent —— if parent is in the set → the real parent;
// otherwise treat as root.
func writingEffectiveParent(w *entity.Writing, present map[string]bool) string {
	pid, ok := w.ParentID()
	if ok && present[pid] {
		return pid
	}
	return ""
}

// writingParentsWithChild —— the set of parent ids with ≥1 child
// (used to compute HasChildren).
func writingParentsWithChild(
	writings []entity.Writing, present map[string]bool,
) map[string]bool {
	out := make(map[string]bool)
	for i := range writings {
		if p := writingEffectiveParent(&writings[i], present); p != "" {
			out[p] = true
		}
	}
	return out
}
