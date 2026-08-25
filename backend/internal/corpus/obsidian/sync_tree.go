// sync_tree.go —— vault 文件批 → 期望的 corp 节点树(对齐 B)。
// folder-note `a/a.md` = 节点 [a](约定 A);leaf `a/b/c.md` = 节点 [a,b,c];缺 folder-note 的中间段
// → 自动补空占位节点(backfill 语义,容忍)。节点按深度浅→深排,保证 upsert 时父先于子。

package obsidian

import (
	"slices"
	"strings"
)

// vaultNote —— 一个待同步的 corp 文件(已解析)。segs = genre 下的路径段(含文件名,去 .md)。
type vaultNote struct {
	genre      string
	sourcePath string
	body       string
	// rawFM —— 这个文件的 frontmatter **原文**（不含 `---` 围栏）。
	// `fm` 是解析后的结果，它只留下产品认识的那十几个 key；导出要写回 owner 自己写的
	// `langs` / `aliases-zh` / `owns`，以及内联数组这类形态，只能靠这一份原文（F-L-67）。
	rawFM string
	segs  []string
	fm    corpFM
}

// desiredNode —— 期望树的一个节点。file == nil = 自动补的中间节点(无 backing 文件)。
type desiredNode struct {
	file        *vaultNote
	genre       string
	title       string
	path        []string
	hasChildren bool
}

// nodePathFor —— 从 segs 推节点路径:folder-note(文件名 == 所在文件夹名)= 那个文件夹节点;否则 leaf。
func nodePathFor(segs []string) []string {
	if len(segs) == 0 {
		return []string{}
	}
	folder := segs[:len(segs)-1]
	name := segs[len(segs)-1]
	if len(folder) > 0 && folder[len(folder)-1] == name {
		return folder
	}
	return append(append([]string{}, folder...), name)
}

func nodeKey(genre string, path []string) string {
	return genre + "\x00" + strings.Join(path, "/")
}

// treeBuilder —— 物化期望节点集的累加器(去重 + 保序)。
type treeBuilder struct {
	byKey map[string]*desiredNode
	order []*desiredNode
}

func (b *treeBuilder) ensure(genre string, path []string) *desiredNode {
	key := nodeKey(genre, path)
	if n, ok := b.byKey[key]; ok {
		return n
	}
	n := &desiredNode{genre: genre, path: append([]string{}, path...), title: path[len(path)-1]}
	b.byKey[key] = n
	b.order = append(b.order, n)
	return n
}

func (b *treeBuilder) addNote(note *vaultNote) {
	np := nodePathFor(note.segs)
	if len(np) == 0 {
		return
	}
	for d := 1; d < len(np); d++ { // ancestors: auto-node when no folder-note (tolerance)
		b.ensure(note.genre, np[:d])
	}
	if node := b.ensure(note.genre, np); node.file == nil {
		node.file = note // first backing file wins the node (name-clash tolerated)
	}
}

// buildDesiredTree —— 物化期望节点集(含容忍补的中间节点),父先子后返回。
func buildDesiredTree(notes []vaultNote) []*desiredNode {
	b := &treeBuilder{byKey: map[string]*desiredNode{}, order: []*desiredNode{}}
	for i := range notes {
		b.addNote(&notes[i])
	}
	markChildren(b.order, b.byKey)
	slices.SortStableFunc(b.order, func(a, c *desiredNode) int {
		return len(a.path) - len(c.path)
	})
	return b.order
}

func markChildren(order []*desiredNode, byKey map[string]*desiredNode) {
	for _, n := range order {
		if len(n.path) <= 1 {
			continue
		}
		if p, ok := byKey[nodeKey(n.genre, n.path[:len(n.path)-1])]; ok {
			p.hasChildren = true
		}
	}
}
