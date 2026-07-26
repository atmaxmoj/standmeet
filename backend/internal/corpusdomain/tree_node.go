// tree_node.go —— Wiki / Output 共用的树结构(parent 链)。
//
// Wiki / Output 是 forest：ParentID nil 是 root；非空 ParentID 指向同 owner
// 同 genre 的另一条。地址(path)纯从这条 parent 链 + title slug 树派生
// (usecases.WikiTreePaths),不存进 entry。

package corpusdomain

// TreeNode —— Wiki / Output 用的 parent 字段。*string 表达可空:nil = root。
type TreeNode struct {
	parentID *string
}

// TreeNodeInit —— 构造参数。
type TreeNodeInit struct {
	ParentID *string
}

// NewTreeNode —— 从 Init 构造；内部 defensive copy 指针指向的值，避免
// caller 后续 mutate。
func NewTreeNode(i *TreeNodeInit) TreeNode {
	n := TreeNode{}
	if i.ParentID != nil {
		v := *i.ParentID
		n.parentID = &v
	}
	return n
}

// ParentID —— 父 entry id；(parentID, true) 或 ("", false) 形态返。Go-y
// 比 *string 安全（避免 caller 通过指针 *p = newID 篡改）。
func (t TreeNode) ParentID() (string, bool) {
	if t.parentID == nil {
		return "", false
	}
	return *t.parentID, true
}

// HasParent —— ParentID() 的 ok-only 版本。
func (t TreeNode) HasParent() bool { return t.parentID != nil }
