// sync.go — entry point for the sync face: vault files → the corpus_notes multi-genre node
// tree (raw folds into genre='raw'). Routing: top-level folder → genre (wiki/subjectivity/raw;
// output has no folder = promote-derived; unknown/bare root files and hidden entries like
// dotdirs/_templates are skipped). reconcile claims by title (cross-genre, supports move); when
// basename isn't unique, it claims by source_path instead (same-name files keep their own row,
// F-L-2) → upsert; skip when unchanged. Links resolve for the whole batch at once. "Unique or
// not" asks the CORPUS, not this upload batch (F-L-61, see sync_ambiguity.go).
//
// THE VAULT IS THE SINGLE LIVE SOURCE (see the vault-ingestion decision): sync makes
// destination equal source, no "who wins". A web edit doesn't pin against the vault; to
// keep it, export it back before the next sync (F-L-6).
//
// Persisted ≠ public (F-L-8): every routed .md persists regardless; frontmatter's `publish`
// only feeds the DB's `published` (old name seo_indexed) = "visible to anonymous visitors /
// in the sitemap"; published=false means "needs a code" not "doesn't exist". The two used to
// share one flag, forcing an owner who wanted to feed the agent grounding to publish it too.
//
// Deletion depends on SyncMode: authoritative (whole vault) prunes vault-imported notes absent
// from this batch (F-L-6); partial (a subset upload) never deletes. See sync_prune.go.

package obsidian

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/i18n"
)

const (
	genreWiki         = "wiki"
	genreSubjectivity = "subjectivity"
	genreRaw          = "raw"
	genreWriting      = "writing"
)

var corpGenres = map[string]bool{genreWiki: true, genreSubjectivity: true}

// IsVaultTopFolder — whether a top-level folder is a synced genre. The route layer
// uses it to tell whether webkitRelativePath's first segment is a "vault folder name"
// (strip it) or a "genre" (keep it); both upload shapes route correctly this way.
func IsVaultTopFolder(seg string) bool {
	return seg == genreWiki || seg == genreSubjectivity || seg == genreRaw ||
		seg == genreWriting || seg == "writings"
}

// SyncNotesPort — corp note reconcile (cross-genre). Implemented by VaultSyncRepo.
// GetByTitle returns corpus.ErrSyncNoteNotFound when nothing matches.
type SyncNotesPort interface {
	GetByTitle(ctx context.Context, ownerID, title string) (corpus.SyncNote, error)
	GetBySourcePath(ctx context.Context, ownerID, sourcePath string) (corpus.SyncNote, error)
	// DuplicateTitles —— titles duplicated cross-genre (lowercased); ask before claiming by title.
	DuplicateTitles(ctx context.Context, ownerID string) ([]string, error)
	// GetByTitleInGenre —— claims by title within one genre; identity for structural nodes
	// (no source_path).
	GetByTitleInGenre(ctx context.Context, ownerID, genre, title string) (corpus.SyncNote, error)
	Create(ctx context.Context, in *corpus.CreateSyncNoteInput) (string, error)
	Update(ctx context.Context, in *corpus.UpdateSyncNoteInput) error
	// PruneAbsentVaultNotes —— drop vault-imported notes not in keepIDs (F-L-6, authoritative).
	PruneAbsentVaultNotes(ctx context.Context, ownerID string, keepIDs []string) (int, error)
}

// SyncRefsPort — a note's `[[links]]` in the body → note_refs (resolved after the batch).
type SyncRefsPort interface {
	RebuildForNote(ctx context.Context, ownerID, noteID, body string) error
}

// SyncWritingsPort — the writing/ subtree (including attachments) → the writings
// table (reuses the old ImportVault flatten-import).
type SyncWritingsPort interface {
	ImportWritings(ctx context.Context, ownerID string, files []VaultFile) ImportResult
}

// SyncDeps — dependencies for the sync face. Refs / Writings / CSS may be nil (optional).
type SyncDeps struct {
	Notes    SyncNotesPort
	Refs     SyncRefsPort
	Writings SyncWritingsPort
	CSS      SyncCSSPort
}

// SyncVault — main entry point for the sync face. mode says whether the upload is
// the whole vault (prune what's absent) or a subset (never delete) — see SyncMode.
func SyncVault(
	ctx context.Context, deps *SyncDeps, ownerID string, files []VaultFile, mode SyncMode,
) ImportResult {
	result := ImportResult{Errors: []string{}}
	b := classifyVault(files)
	syncWritings(ctx, deps, ownerID, b.writing, &result)
	syncCSS(ctx, deps, ownerID, b.css)
	tree := buildDesiredTree(b.corp)
	// Ask the corpus which titles are ambiguous before touching anything; if that can't
	// be answered, do nothing for the whole batch — claiming by title without knowing
	// where the ambiguity is means gambling with notes in other genres (sync_ambiguity.go).
	dup, derr := ambiguousTitles(ctx, deps, ownerID, tree)
	if derr != nil {
		result.Errors = append(result.Errors, derr.Error())
		return result
	}
	st := &syncState{ownerID: ownerID, idOf: map[string]string{}, dupTitles: dup}
	for _, node := range tree {
		reconcileNode(ctx, deps, node, st, &result)
	}
	resolveLinks(ctx, deps, st, tree)
	pruneAbsent(ctx, deps, st, mode, &result)
	return result
}

// syncWritings — hands the writing/ subtree (including attachments) to the writings
// importer, folding its stats into the overall result.
func syncWritings(
	ctx context.Context, deps *SyncDeps, ownerID string, files []VaultFile, result *ImportResult,
) {
	if deps.Writings == nil || len(files) == 0 {
		return
	}
	wr := deps.Writings.ImportWritings(ctx, ownerID, files)
	result.Created += wr.Created
	result.Updated += wr.Updated
	result.Skipped += wr.Skipped
	// Kept must be merged in too — the basis for what prune spares (F-L-63); drop
	// this and prune deletes this batch in the same request as "no longer in the vault".
	result.Kept = append(result.Kept, wr.Kept...)
	result.Errors = append(result.Errors, wr.Errors...)
}

// syncState — mutable state for one sync: node (genre,path)→id. Parent chains and link
// hooking SHARE THE SAME IDENTITY. A `titleToID` map used to live here too (only link
// resolution read it) but was deleted: vault basenames aren't unique, so a title lookup
// is bound to grab the wrong note, and a table indexed by a non-unique key sitting there
// is bound to get read again by someone eventually (F-L-60).
type syncState struct {
	idOf      map[string]string
	dupTitles map[string]bool // lowercased titles that are ambiguous → claim by source_path
	ownerID   string
}

// nodeOp — argument bundle for reconciling one node (dodges the argument-limit lint).
type nodeOp struct {
	deps   *SyncDeps
	node   *desiredNode
	st     *syncState
	result *ImportResult
	c      *nodeContent
	parent *string
}

// claimExisting — entry point for reconcile to claim a matching note. Claims by title by
// default (cross-genre, supports move). When the title is ambiguous (same-name files in
// different folders, already in the corpus or just within this batch), claiming by title
// is a lottery and the loser might live in a different genre (ambiguity set computed in
// sync_ambiguity.go). When ambiguous, split by whether the node has a file:
//
//   - Has a file → claim by source_path (unique paths); same-name files each keep their
//     own row (see the obsidian_source_path comment + corpus_notes_source_path_idx).
//   - Structural node (folder placeholder, empty source_path, empty paths collide) →
//     claim by title WITHIN ITS OWN GENRE: identity is "that folder in its own tree".
//     raw/math/ and wiki/math/ coexisting is normal; claiming across genres would drag
//     one tree's folder into another genre (F-L-61).
func claimExisting(
	ctx context.Context, deps *SyncDeps, node *desiredNode, st *syncState,
) (corpus.SyncNote, error) {
	if !st.dupTitles[strings.ToLower(node.title)] {
		note, err := deps.Notes.GetByTitle(ctx, st.ownerID, node.title)
		return note, wrapClaim(err)
	}
	if node.file != nil && node.file.sourcePath != "" {
		note, err := deps.Notes.GetBySourcePath(ctx, st.ownerID, node.file.sourcePath)
		return note, wrapClaim(err)
	}
	note, err := deps.Notes.GetByTitleInGenre(ctx, st.ownerID, node.genre, node.title)
	return note, wrapClaim(err)
}

// wrapClaim — wraps claim errors (satisfies wrapcheck), but passes ErrSyncNoteNotFound
// through unchanged: reconcileNode uses errors.Is to read it as a "create" signal (%w
// would still Is-match, but leaving it as-is is simpler).
func wrapClaim(err error) error {
	if err == nil || errors.Is(err, corpus.ErrSyncNoteNotFound) {
		return err
	}
	return fmt.Errorf("claim existing note: %w", err)
}

func reconcileNode(
	ctx context.Context, deps *SyncDeps, node *desiredNode, st *syncState, result *ImportResult,
) {
	existing, err := claimExisting(ctx, deps, node, st)
	c := contentOf(node)
	noteI18nNotices(result, node.title, &c)
	op := &nodeOp{
		deps: deps, node: node, st: st, result: result, c: &c, parent: parentIDOf(st, node),
	}
	switch {
	case errors.Is(err, corpus.ErrSyncNoteNotFound):
		createNode(ctx, op)
	case err != nil:
		result.Errors = append(result.Errors, node.title+": "+err.Error())
	default:
		updateNode(ctx, op, &existing)
	}
}

func createNode(ctx context.Context, op *nodeOp) {
	id, err := op.deps.Notes.Create(ctx, &corpus.CreateSyncNoteInput{
		OwnerID: op.st.ownerID, Genre: op.node.genre, ParentID: op.parent, Title: op.node.title,
		Body: op.c.body, Excerpt: op.c.excerpt, Tags: op.c.tags, Published: op.c.published,
		SourcePath: op.c.srcPath, CSSClasses: op.c.cssClasses, Aliases: op.c.aliases,
		Lang: op.c.lang, LangLabels: marshalLabels(op.c.langLabels),
		InboxSource: inboxSourceFor(op.node.genre, op.c), Frontmatter: op.c.rawFM,
	})
	if err != nil {
		op.result.Errors = append(op.result.Errors, op.node.title+": "+err.Error())
		return
	}
	record(op.st, op.node, id)
	op.result.Created++
}

func updateNode(ctx context.Context, op *nodeOp, existing *corpus.SyncNote) {
	record(op.st, op.node, existing.ID) // always index for link resolution + child parenting
	// The vault didn't mention publish → carry forward the existing value; don't treat
	// "unsaid" as "said no" (F-L-22). Fill this in BEFORE the comparison, or a note
	// that only differs on publish gets judged changed and overwritten by that false.
	keepPublish(op.c, existing.Published)
	if unchangedNode(existing, op.node, op.parent, op.c) {
		op.result.Skipped++
		return
	}
	if err := op.deps.Notes.Update(ctx, &corpus.UpdateSyncNoteInput{
		ID: existing.ID, OwnerID: op.st.ownerID, Genre: op.node.genre, ParentID: op.parent,
		Body: op.c.body, Excerpt: op.c.excerpt, Tags: op.c.tags, Published: op.c.published,
		SourcePath: op.c.srcPath, CSSClasses: op.c.cssClasses, Aliases: op.c.aliases,
		Lang: op.c.lang, LangLabels: marshalLabels(op.c.langLabels),
		InboxSource: inboxSourceFor(op.node.genre, op.c), Frontmatter: op.c.rawFM,
	}); err != nil {
		op.result.Errors = append(op.result.Errors, op.node.title+": "+err.Error())
		return
	}
	op.result.Updated++
}

func parentIDOf(st *syncState, n *desiredNode) *string {
	if len(n.path) <= 1 {
		return nil
	}
	if id, ok := st.idOf[nodeKey(n.genre, n.path[:len(n.path)-1])]; ok {
		return &id
	}
	return nil
}

func record(st *syncState, node *desiredNode, id string) {
	st.idOf[nodeKey(node.genre, node.path)] = id
}

func unchangedNode(sn *corpus.SyncNote, n *desiredNode, parent *string, c *nodeContent) bool {
	return unchangedFields(sn, c) && sn.Genre == n.genre &&
		sameParent(sn.ParentID, parent) && sameStrings(sn.Tags, c.tags)
}

// unchangedFields —— the scalar-content fields (body / excerpt / publish) are unchanged.
func unchangedFields(sn *corpus.SyncNote, c *nodeContent) bool {
	return sn.Body == c.body && sn.Excerpt == c.excerpt && sn.Published == c.published
}

func sameParent(existing string, desired *string) bool {
	if desired == nil {
		return existing == ""
	}
	return existing == *desired
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func resolveLinks(ctx context.Context, deps *SyncDeps, st *syncState, tree []*desiredNode) {
	if deps.Refs == nil {
		return
	}
	for _, node := range tree {
		resolveNoteLinks(ctx, deps, st, node)
	}
}

func resolveNoteLinks(ctx context.Context, deps *SyncDeps, st *syncState, node *desiredNode) {
	if node.file == nil {
		return
	}
	// FIND THIS NOTE BY PATH, NOT BY TITLE (F-L-60): vault basenames aren't unique
	// (`theory/theory.md` has a copy in three folders). This used to bucket same-name
	// notes by `st.titleToID[node.title]`, but `RebuildForNote(id, body)` is a REBUILD:
	// whichever note processes later overwrites the earlier one's edges, emptying the
	// bucket if it has no links itself. Prod cost: of 97 same-name notes, only 22 had
	// outgoing edges — 41 had `[[` in their body with ZERO EDGES, though check-links.sh
	// says those links are good; the loss was silent, our side only. Reconcile already
	// claims by `source_path` (F-L-2); this half hadn't caught up. `st.idOf` is the
	// same (genre, path) table parent-chain computation already uses.
	id, ok := st.idOf[nodeKey(node.genre, node.path)]
	if !ok {
		return
	}
	// best-effort: a link-resolution failure shouldn't fail the whole sync batch.
	if err := deps.Refs.RebuildForNote(ctx, st.ownerID, id, node.file.body); err != nil {
		return
	}
}

// marshalLabels — lang-labels → jsonb bytes. Empty map / can't marshal → nil; the repo
// side persists it as `{}`. Treat "can't marshal" as "wrote nothing" — a bad language-
// switcher label shouldn't fail the whole note's sync.
func marshalLabels(labels map[string]string) []byte {
	if len(labels) == 0 {
		return []byte{}
	}
	b, err := json.Marshal(labels)
	if err != nil {
		return []byte{}
	}
	return b
}

// noteI18nNotices — flags issues in this note's multi-lang structure. SYNC ACCEPTS IT
// ANYWAY: it's a mirror, refusing means vault content can't get in. But a note rendering
// only half an article can't fail silently — the diagnostic attaches to the result, the
// panel prints it, and the owner learns which one to go fix.
func noteI18nNotices(result *ImportResult, title string, c *nodeContent) {
	ds := i18n.Validate(&i18n.Frontmatter{Lang: c.lang}, c.body)
	for i := range ds {
		result.Notices = append(result.Notices, title+": "+ds[i].Message)
	}
}
