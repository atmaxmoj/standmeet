// export_corpus.go —— corp note(wiki/subjectivity/output)反向渲染成 vault .md 写进 export zip,
// 跟 sync import 互逆:genre folder + 节点树 + folder-note(有子节点写成 foo/foo.md)+ frontmatter。

package obsidian

import (
	"archive/zip"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/postgres"
)

const notePathMaxDepth = 64

// noteIndex —— export 用的节点索引:id→节点 + 每节点子数(判 folder-note)。
type noteIndex struct {
	byID       map[string]*postgres.SyncNote
	childCount map[string]int
}

// writeCorpusNotes —— 把 owner 的 corp note 写进 zip。writing 折进 corpus_notes(#151)后也在
// ListAllForExport 里,但 writing 有专属 export(writeAllWritings → writings/<slug>.md,带附件 +
// cover/visibility frontmatter),故这条通用路径先滤掉 genre='writing' 免得重复导出。
func writeCorpusNotes(notes []postgres.SyncNote, zw *zip.Writer) error {
	notes = nonWritingNotes(notes)
	idx := &noteIndex{
		byID: make(map[string]*postgres.SyncNote, len(notes)), childCount: map[string]int{},
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
func nonWritingNotes(notes []postgres.SyncNote) []postgres.SyncNote {
	out := make([]postgres.SyncNote, 0, len(notes))
	for i := range notes {
		if notes[i].Genre != genreWriting {
			out = append(out, notes[i])
		}
	}
	return out
}

func writeOneNote(n *postgres.SyncNote, idx *noteIndex, zw *zip.Writer) error {
	path := notePath(n, idx.byID)
	base := n.Genre + "/" + strings.Join(path, "/")
	file := base + ".md"
	if idx.childCount[n.ID] > 0 && len(path) > 0 { // 有子节点 → folder-note foo/foo.md
		file = base + "/" + path[len(path)-1] + ".md"
	}
	entry, err := zw.Create(file)
	if err != nil {
		return fmt.Errorf("create zip entry: %w", err)
	}
	if _, werr := entry.Write([]byte(renderNoteMD(n))); werr != nil {
		return fmt.Errorf("write note md: %w", werr)
	}
	return nil
}

// notePath —— 从根到本节点的 title 链(深度上限防环)。
func notePath(n *postgres.SyncNote, byID map[string]*postgres.SyncNote) []string {
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

// renderNoteMD —— frontmatter(publish + tags)+ body,格式跟 import 侧对称。
func renderNoteMD(n *postgres.SyncNote) string {
	lines := []string{"---", fmt.Sprintf("publish: %t", n.Published)}
	if len(n.Tags) > 0 {
		lines = append(lines, "tags:")
		for _, t := range n.Tags {
			lines = append(lines, "  - "+t)
		}
	}
	lines = append(lines, "---", "")
	body := n.Body
	if !strings.HasSuffix(body, newline) {
		body += newline
	}
	return strings.Join(lines, newline) + newline + body
}
