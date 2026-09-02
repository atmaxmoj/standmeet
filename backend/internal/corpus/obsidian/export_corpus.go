// export_corpus.go -- renders corp notes (wiki/subjectivity/output) back
// into vault .md files written into the export zip. Inverse of sync
// import: genre folder + node tree + folder-notes (a node with children is
// written as foo/foo.md) + frontmatter.

package obsidian

import (
	"archive/zip"
	"fmt"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

const notePathMaxDepth = 64

// noteIndex -- the node index used by export: id -> node, plus each node's
// child count (to decide folder-note).
type noteIndex struct {
	byID       map[string]*corpus.SyncNote
	childCount map[string]int
}

// writeCorpusNotes -- writes an owner's corp notes into the zip. Now that
// writing has folded into corpus_notes (#151), writing also shows up in
// ListAllForExport, but writing has its own dedicated export
// (writeAllWritings -> writings/<slug>.md, with attachments +
// cover/visibility frontmatter), so this generic path filters out
// genre='writing' first to avoid double export.
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

// nonWritingNotes -- filters out genre='writing' (it goes through its own
// dedicated export, not re-exported on this generic corp-note path).
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

// notePathInVault -- which vault path this note should be written back to.
//
// The tree alone can justify **two** equally valid forms: `x/y.md` (a
// sibling file) and `x/y/y.md` (a folder-note, the note living inside a
// folder of the same name). When there are children, only the latter makes
// sense, and that case has always been handled correctly. The disagreement
// is in the **no-children** cell: looking at the tree alone would write
// `x/y.md`, but in the owner's vault it may already live in `x/y/` (22
// notes in the real vault have exactly this shape -- a folder containing
// only itself).
//
// So here we first ask **where it came from**: if the source path still
// points to the same location in folder-note form, it's written back
// as-is. The mirror's job is to map the note back, not to decide on the
// owner's behalf whether the folder should stay (F-L-68).
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

// notePath -- the title chain from root to this node (depth cap guards
// against cycles).
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

// renderNoteMD -- frontmatter + body, in a format symmetric with the
// import side.
//
// The word "symmetric" used to be a lie (F-L-59): import parses and stores
// `lang` and `aliases`, but export only wrote publish + tags, so all three
// keys present on every one of the real vault's 575 wiki notes were absent
// from all 575 exported ones. And the round-trip test for an item is
// exactly "export it, then import it back" -- that step would wipe out the
// bilingual pairing and the `[[alias]]` resolution input on real corpus
// data. So symmetry has to hold **field by field**, not as a comment
// claiming it does.
func renderNoteMD(n *corpus.SyncNote) string {
	// raw is frontmatter-exempt on both sides. The import side already was
	// (sync_classify.go's `toRawVaultNote`: **the whole file is body**,
	// including the `---` delimiters), while this side used to write a
	// `---publish---` block regardless of genre -- so every round trip
	// stacked one more block on top, unbounded (F-L-66).
	//
	// The cost wasn't just growing files: after the first round trip, the
	// note's own `tags` / `status` stopped being frontmatter and became
	// body text. Obsidian's Properties panel and tag graph broke for these
	// notes instantly.
	//
	// Writing frontmatter here was also **write-only, never read**: raw's
	// import never parses frontmatter at all, so the `publish:` / `tags:`
	// written out would just be treated as body text on the next import --
	// it never carried any information, it only fed the loop.
	if n.Genre == genreRaw {
		return ensureTrailingNewline(n.Body)
	}
	return fmDelim + newline + frontmatterBlock(n) + newline +
		fmDelim + newline + newline + ensureTrailingNewline(n.Body)
}

// frontmatterBlock -- this block's content (fence excluded). A note that
// came from the vault goes through the patch path; one newly created via
// web/MCP goes through rendering. The line between the two paths is
// whether original text exists, not genre and not a timestamp.
func frontmatterBlock(n *corpus.SyncNote) string {
	if n.Frontmatter == "" {
		return renderOwnedBlock(n)
	}
	return patchFrontmatter(strings.TrimRight(n.Frontmatter, newline), n)
}

// ensureTrailingNewline -- appends a trailing newline to body (avoids
// owner editor warnings).
func ensureTrailingNewline(body string) string {
	if strings.HasSuffix(body, newline) {
		return body
	}
	return body + newline
}
