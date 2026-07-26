// writing_tree.go —— reader sidebar 的 writing 树懒加载分层。跟 wiki 树同形
// (nodesUnder/effectiveParent),但 ACL 口径不同:
//   - 可见性 = published(草稿不进公开树)。输入已是 published 列表 → 全可见。
//   - private(visibility != public)**仍在树里显示**,标 Locked(设计要 show
//     locked 节点,italic),跟 wiki「不泄露 gated 标题」相反。
//   - 导航按 slug(writing landing 是 /writings/<slug>),不像 wiki 用 tree-path。

package corpus

// WritingTreeNode —— 树一层的一个节点。Locked = private(teaser only)。
type WritingTreeNode struct {
	ID          string
	Title       string
	Slug        string
	HasChildren bool
	Locked      bool
}

// WritingTreeChildren —— published 列表里 parentID 的直接子(parentID="" → roots)。
// parent 不在 published 集内(草稿/删)→ 子升为 root。
func WritingTreeChildren(writings []Writing, parentID string) []WritingTreeNode {
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

func writingNode(w *Writing, hasKids map[string]bool) WritingTreeNode {
	return WritingTreeNode{
		ID: w.ID(), Title: w.Title(), Slug: w.Slug(),
		HasChildren: hasKids[w.ID()], Locked: !w.Visibility().IsPublic(),
	}
}

// writingIDSet —— published 集内的 id。
func writingIDSet(writings []Writing) map[string]bool {
	out := make(map[string]bool, len(writings))
	for i := range writings {
		out[writings[i].ID()] = true
	}
	return out
}

// writingEffectiveParent —— parent 在集内 → 真 parent;否则当 root。
func writingEffectiveParent(w *Writing, present map[string]bool) string {
	pid, ok := w.ParentID()
	if ok && present[pid] {
		return pid
	}
	return ""
}

// writingParentsWithChild —— 有 ≥1 子的 parent id 集(算 HasChildren)。
func writingParentsWithChild(
	writings []Writing, present map[string]bool,
) map[string]bool {
	out := make(map[string]bool)
	for i := range writings {
		if p := writingEffectiveParent(&writings[i], present); p != "" {
			out[p] = true
		}
	}
	return out
}
