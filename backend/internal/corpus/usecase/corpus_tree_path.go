// corpus_tree_path.go —— document 的地址 = 它在 parent 树里的位置算出来的 path,
// 每段是 slug 化的 title。一个概念、一个词:path。
//
// 不存进文档、不靠可空的列:corpus 是 filesystem,文件路径来自它在哪个目录下。
// root(无 parent / parent 不在集合内)= 自己一段;有 parent = parent路径 + '/' +
// 自己段。永远非空、永远可寻址,不存在孤儿文档。retriever(visitor chat)和
// citation 反查(dialog)都用这套算 path,口径一致。

package usecase

import (
	"strconv"
	"strings"
	"unicode"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// TreeMaxDepth —— 防环路 / 异常深树。
const TreeMaxDepth = 32

// pathSegmentMaxLen —— 单段截断,够表意又不失控。
const pathSegmentMaxLen = 80

// pathNode —— 算 path 只需要 id / title / parent。Wiki 和 Output
// 同构两棵树,各自折成 pathNode 后共用一套计算。
type pathNode struct {
	id        string
	title     string
	parentID  string
	hasParent bool
}

// WikiTreePaths / OutputTreePaths —— 给一组同 owner 的 document 算 id→树路径
// 地址表(见 treePathsFor)。retriever 报地址(search/read/ACL)、citation 反查、
// 公开页 landing、admin 浏览全查这张表 —— 一套树派生口径,不存列。
func WikiTreePaths(ws []entity.Wiki) map[string]string {
	nodes := make([]pathNode, len(ws))
	for i := range ws {
		pid, ok := ws[i].ParentID()
		nodes[i] = pathNode{id: ws[i].ID(), title: ws[i].Title(), parentID: pid, hasParent: ok}
	}
	return treePathsFor(nodes)
}

// OutputTreePaths —— WikiTreePaths 的 output 孪生(同一套树派生口径)。
func OutputTreePaths(os []entity.Output) map[string]string {
	nodes := make([]pathNode, len(os))
	for i := range os {
		pid, ok := os[i].ParentID()
		nodes[i] = pathNode{id: os[i].ID(), title: os[i].Title(), parentID: pid, hasParent: ok}
	}
	return treePathsFor(nodes)
}

// RawTreePaths —— WikiTreePaths 的 raw 孪生:raw 现是 corpus_notes 的 genre='raw' 节点,
// 同一套树派生口径(parent 链 + slug(title))。admin /raw 列表用它算每条地址。
func RawTreePaths(rs []entity.Raw) map[string]string {
	nodes := make([]pathNode, len(rs))
	for i := range rs {
		pid, ok := rs[i].ParentID()
		nodes[i] = pathNode{id: rs[i].ID(), title: rs[i].Title(), parentID: pid, hasParent: ok}
	}
	return treePathsFor(nodes)
}

// WikiMetaTreePaths / OutputMetaTreePaths —— 同一套树派生口径,但吃 meta(无 body)。
// landing/sitemap 用全量 meta(ListAllMeta,无 50-cap)算 path,不必 load 全量 body。
func WikiMetaTreePaths(metas []repo.WikiMeta) map[string]string {
	return treePathsFor(wikiMetaNodes(metas))
}

// OutputMetaTreePaths —— WikiMetaTreePaths 的 output 孪生。
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

// treePathsFor —— path = 从根到该节点每段 slug 化的 title,'/' 连接。撞 path(同
// 父下同 slug)按出现顺序加 -2/-3 去重(seen 仅构造期用,保证 path→id 单射)。
// 返回 id→path。
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

// computePath —— 走 parent 链(限定在本集合内)拼出 root→self 的 path。parent
// 不在集合内(被删 / ACL 切掉)就当 root,从那段起。
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

// uniquePath —— base 没占用就用 base,否则 base-2 / base-3 … 直到空位。
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

// SlugifyTitle —— PathSegment 的导出包装。eval fixture 给某条 corpus 算授权 URI 时
// 用,跟 retriever 的 WikiPathByID/OutputPathByID(flat fixture 无 parent → 单段
// PathSegment(title))对齐,免得 grant 用旧 uri-path 而 retriever 用 title 派生 path
// 对不上 → ACL 全拒。
func SlugifyTitle(title string) string { return PathSegment(title) }

// PathSegment —— title 转一个 URL-safe path 段:小写;字母/数字(含 unicode,path
// 列 citext 收得下)为词,其余字符全当分隔 → FieldsFunc 切词 + '-' 连(自动去首尾
// /合并连续分隔)。截断到 pathSegmentMaxLen。空(纯符号 title)→ "untitled" 兜底。
func PathSegment(title string) string {
	words := strings.FieldsFunc(strings.ToLower(title), isPathSeparator)
	out := strings.Join(words, "-")
	if len(out) > pathSegmentMaxLen {
		out = strings.Trim(out[:pathSegmentMaxLen], "-")
	}
	if out == "" {
		return "untitled"
	}
	return out
}

// isPathSeparator —— 非字母非数字都当 path 段内的分隔符。
func isPathSeparator(r rune) bool {
	return !unicode.IsLetter(r) && !unicode.IsNumber(r)
}
