// sync_tree.go — a batch of vault files → the desired corp node tree (aligns with B).
// folder-note `a/a.md` = node [a] (convention A); leaf `a/b/c.md` = node [a,b,c]; an
// intermediate segment missing its folder-note gets an auto-filled empty placeholder
// node (backfill semantics, tolerant). Nodes sort shallow→deep so upsert writes parents
// before children.

package obsidian

import (
	"slices"
	"strings"
)

// vaultNote — a corp file awaiting sync (already parsed). segs = the path segments
// under the genre (includes the filename, with .md stripped).
type vaultNote struct {
	genre      string
	sourcePath string
	body       string
	// rawFM —— this file's frontmatter, VERBATIM (the `---` fences excluded).
	// `fm` is the parsed result, which keeps only the dozen-odd keys the product
	// understands; export must write back owner-authored keys like `langs` /
	// `aliases-zh` / `owns`, plus forms like inline arrays, and only this raw
	// text can supply that (F-L-67).
	rawFM string
	segs  []string
	fm    corpFM
}

// desiredNode — one node of the desired tree. file == nil = an auto-filled
// intermediate node (no backing file).
type desiredNode struct {
	file        *vaultNote
	genre       string
	title       string
	path        []string
	hasChildren bool
}

// nodePathFor — derives the node path from segs: a folder-note (filename ==
// its containing folder's name) = that folder node; otherwise a leaf.
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

// treeBuilder — accumulator that materializes the desired node set (dedupes,
// preserves order).
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

// buildDesiredTree — materializes the desired node set (including tolerantly
// backfilled intermediate nodes), returned parent-before-child.
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
