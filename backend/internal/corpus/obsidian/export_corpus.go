// export_corpus.go —— corp note(wiki/subjectivity/output)反向渲染成 vault .md 写进 export zip,
// 跟 sync import 互逆:genre folder + 节点树 + folder-note(有子节点写成 foo/foo.md)+ frontmatter。

package obsidian

import (
	"archive/zip"
	"fmt"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

const notePathMaxDepth = 64

// noteIndex —— export 用的节点索引:id→节点 + 每节点子数(判 folder-note)。
type noteIndex struct {
	byID       map[string]*corpus.SyncNote
	childCount map[string]int
}

// writeCorpusNotes —— 把 owner 的 corp note 写进 zip。writing 折进 corpus_notes(#151)后也在
// ListAllForExport 里,但 writing 有专属 export(writeAllWritings → writings/<slug>.md,带附件 +
// cover/visibility frontmatter),故这条通用路径先滤掉 genre='writing' 免得重复导出。
func writeCorpusNotes(notes []corpus.SyncNote, zw *zip.Writer) error {
	notes = nonWritingNotes(notes)
	idx := &noteIndex{
		byID: make(map[string]*corpus.SyncNote, len(notes)), childCount: map[string]int{},
	}
	for i := range notes {
		idx.byID[notes[i].ID] = &notes[i]
		if notes[i].ParentID != "" {
			idx.childCount[notes[i].ParentID]++
		}
	}
	for i := range notes {
		if err := writeOneNote(&notes[i], idx, zw); err != nil {
			return err
		}
	}
	return nil
}

// nonWritingNotes —— 滤掉 genre='writing'(走专属 export,不在通用 corp-note 路径重复导出)。
func nonWritingNotes(notes []corpus.SyncNote) []corpus.SyncNote {
	out := make([]corpus.SyncNote, 0, len(notes))
	for i := range notes {
		if notes[i].Genre != genreWriting {
			out = append(out, notes[i])
		}
	}
	return out
}

func writeOneNote(n *corpus.SyncNote, idx *noteIndex, zw *zip.Writer) error {
	file := notePathInVault(n, idx)
	entry, err := zw.Create(file)
	if err != nil {
		return fmt.Errorf("create zip entry: %w", err)
	}
	if _, werr := entry.Write([]byte(renderNoteMD(n))); werr != nil {
		return fmt.Errorf("write note md: %w", werr)
	}
	return nil
}

// notePathInVault —— 这条笔记该写回 vault 的哪个路径。
//
// 树能推出**两种**都合法的写法：`x/y.md`（同级）和 `x/y/y.md`（folder-note，笔记住在同名
// 文件夹里）。有子节点时只有后者说得通，那一条一直是对的。分歧在**没有子节点**的那一格：
// 光看树会写成 `x/y.md`，而 owner 的 vault 里它可能本来就住在 `x/y/` 里（真 vault 上 22 篇
// 是这个形状 —— 一个只装着自己的文件夹）。
//
// 所以这里先问**它是从哪儿来的**：来路还指向同一个位置的 folder-note 形状，就照原样写回去。
// 镜像的职责是映回去，不是替 owner 决定文件夹该不该留（F-L-68）。
func notePathInVault(n *corpus.SyncNote, idx *noteIndex) string {
	path := notePath(n, idx.byID)
	base := n.Genre + "/" + strings.Join(path, "/")
	if len(path) == 0 {
		return base + ".md"
	}
	folderForm := base + "/" + path[len(path)-1] + ".md"
	if idx.childCount[n.ID] > 0 || n.SourcePath == folderForm {
		return folderForm
	}
	return base + ".md"
}

// notePath —— 从根到本节点的 title 链(深度上限防环)。
func notePath(n *corpus.SyncNote, byID map[string]*corpus.SyncNote) []string {
	rev := []string{}
	for cur, depth := n, 0; cur != nil && depth < notePathMaxDepth; depth++ {
		rev = append(rev, cur.Title)
		if cur.ParentID == "" {
			break
		}
		cur = byID[cur.ParentID]
	}
	out := make([]string, len(rev))
	for i := range rev {
		out[len(rev)-1-i] = rev[i]
	}
	return out
}

// renderNoteMD —— frontmatter + body,格式跟 import 侧对称。
//
// 「对称」这句话以前是假的（F-L-59）：导入解析并存下了 `lang` 和 `aliases`，导出只写
// publish + tags，于是真 vault 的 575 条 wiki 每条都带的三个键，在导出的 575 条里一个都
// 没有。而 item 的往返判据下一步就是「把导出再导回来」—— 那一步会把双语配对和
// `[[别名]]` 的解析输入在真语料上抹平。所以对称必须**逐个字段**成立，不是一句注释。
func renderNoteMD(n *corpus.SyncNote) string {
	// raw 两侧都 fm-exempt。导入侧早就是了（sync_classify.go 的 `toRawVaultNote`：
	// **整个文件都是 body**，连 `---` 分隔符也是），而这里以前不分 genre 一律先写一块
	// `---publish---` —— 于是每往返一次就在顶上多叠一块，无上限（F-L-66）。
	//
	// 代价不只是文件变长：第一轮之后，笔记自己的 `tags` / `status` 不再是 frontmatter，
	// 它们成了正文。Obsidian 的属性和标签图谱对这些笔记当场失效。
	//
	// 往这里写 frontmatter 本来也是**只写不读**：raw 的导入根本不解析 frontmatter，
	// 所以写出去的 `publish:` / `tags:` 下一次导入只会被当成正文 —— 它从来没有承载过
	// 任何东西，只是在制造那个环。
	if n.Genre == genreRaw {
		return ensureTrailingNewline(n.Body)
	}
	return fmDelim + newline + frontmatterBlock(n) + newline +
		fmDelim + newline + newline + ensureTrailingNewline(n.Body)
}

// frontmatterBlock —— 这一块的内容（不含围栏）。来自 vault 的笔记走补丁，
// 网页/MCP 新建的走渲染。两条路的分界就是「有没有原文」，不是 genre 也不是时间戳。
func frontmatterBlock(n *corpus.SyncNote) string {
	if n.Frontmatter == "" {
		return renderOwnedBlock(n)
	}
	return patchFrontmatter(strings.TrimRight(n.Frontmatter, newline), n)
}

// ensureTrailingNewline —— body 末尾补一个换行（避免 owner 编辑器警告）。
func ensureTrailingNewline(body string) string {
	if strings.HasSuffix(body, newline) {
		return body
	}
	return body + newline
}
