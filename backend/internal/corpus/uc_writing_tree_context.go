// writing_tree_context.go —— 一篇 writing 的上下文:祖先链(breadcrumb)+ 直接子
// (sub-rail / 文章页树框)。跟 writing 树同口径(published + locked 标记),按 slug
// 定位。reader 文章页 SSR 拿这个画 breadcrumb。

package corpus

// WritingContext —— 节点上下文。Ancestors 是 root→parent 顺序(不含自己)。
type WritingContext struct {
	Ancestors []WritingTreeNode
	Children  []WritingTreeNode
}

// WritingNodeContext —— published 列表里 slug 那条的祖先链 + 直接子。slug 不在
// published 集 → 空上下文。
func WritingNodeContext(writings []Writing, slug string) WritingContext {
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

// writingIndexAtSlug —— slug 命中那条的下标。
func writingIndexAtSlug(writings []Writing, slug string) (int, bool) {
	for i := range writings {
		if writings[i].Slug() == slug {
			return i, true
		}
	}
	return 0, false
}

// writingAncestorsOf —— 沿 effective-parent 链上溯,收祖先,root→parent 排序。
func writingAncestorsOf(
	writings []Writing, present map[string]bool, idx int,
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

// writingIndexByID —— id → 下标。
func writingIndexByID(writings []Writing) map[string]int {
	out := make(map[string]int, len(writings))
	for i := range writings {
		out[writings[i].ID()] = i
	}
	return out
}
