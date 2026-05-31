// tree_node.go —— Wiki / Output 共用的树结构 + path 寻址 sub-object。
//
// Wiki / Output 是 forest：ParentID nil 是 root；非空 ParentID 指向同 owner
// 同 genre 的另一条。Path 是 owner 显式起的 URL-friendly 标识（例
// "projects/lucerna"），跟 wiki tree 父子链不一定一致（owner 自由配）。
// Path 为空 → 该 entry 不能被公开 /<handle>/wiki/<path> 路径访问，但
// retriever corpus_read 可走 fallback `wiki/<id>` URI 寻址。

package domain

// TreeNode —— Wiki / Output 用的 parent + path 字段集。
//
// 两个字段都是 *string 表达"可空"：
//   - ParentID nil = root
//   - Path     nil = no public URL path
type TreeNode struct {
	parentID *string
	path     *string
}

// TreeNodeInit —— 构造参数。
type TreeNodeInit struct {
	ParentID *string
	Path     *string
}

// NewTreeNode —— 从 Init 构造；内部 defensive copy 指针指向的值，避免
// caller 后续 mutate。
func NewTreeNode(i *TreeNodeInit) TreeNode {
	n := TreeNode{}
	if i.ParentID != nil {
		v := *i.ParentID
		n.parentID = &v
	}
	if i.Path != nil {
		v := *i.Path
		n.path = &v
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

// Path —— owner 配的 path；(path, true) 或 ("", false) 返。
func (t TreeNode) Path() (string, bool) {
	if t.path == nil {
		return "", false
	}
	return *t.path, true
}

// HasPath —— Path() 的 ok-only 版本。
func (t TreeNode) HasPath() bool { return t.path != nil }

// HasParent —— ParentID() 的 ok-only 版本。
func (t TreeNode) HasParent() bool { return t.parentID != nil }

// PathOrEmpty —— 兼容现有 callers 习惯的 path-or-empty-string 形态。
// caller 不区分 "nil path" vs "empty string" 时用这个。
func (t TreeNode) PathOrEmpty() string {
	if t.path == nil {
		return ""
	}
	return *t.path
}
