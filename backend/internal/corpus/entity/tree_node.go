// tree_node.go —— the tree structure (parent chain) shared by Wiki / Output.
//
// Wiki / Output form a forest: a nil ParentID is a root; a non-nil ParentID
// points to another entry of the same owner and genre. The address (path) is
// derived purely from this parent chain + the title-slug tree
// (usecases.WikiTreePaths), and is not stored on the entry.

package entity

// TreeNode —— the parent field shared by Wiki / Output. *string expresses
// nullability: nil = root.
type TreeNode struct {
	parentID *string
}

// TreeNodeInit —— constructor params.
type TreeNodeInit struct {
	ParentID *string
}

// NewTreeNode —— constructs from Init; defensive-copies the pointed-to value
// internally so the caller can't mutate it afterward.
func NewTreeNode(i *TreeNodeInit) TreeNode {
	n := TreeNode{}
	if i.ParentID != nil {
		v := *i.ParentID
		n.parentID = &v
	}
	return n
}

// ParentID —— the parent entry's id; returned as (parentID, true) or ("", false).
// More Go-idiomatic and safer than *string (prevents a caller from tampering via
// the pointer with *p = newID).
func (t TreeNode) ParentID() (string, bool) {
	if t.parentID == nil {
		return "", false
	}
	return *t.parentID, true
}

// HasParent —— the ok-only version of ParentID().
func (t TreeNode) HasParent() bool { return t.parentID != nil }
