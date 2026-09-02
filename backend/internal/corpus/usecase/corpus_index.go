// corpus_index.go —— corpus → Meili index propagation (the 1b crawl face).
//
// Postgres is the source of truth; Meili is a derived projection. The write path
// syncs changes into Meili: promote/update/publish → IndexNote (single-row upsert),
// delete → DeleteNote, sync/backfill/reconcile → ReindexOwner (full rebuild).
// **Best-effort**: an index failure only logs a warning and never fails the corpus
// write (once Postgres has landed the row, the fact is established; Meili catches up
// later via reconcile once it's healthy again). Path is computed via PathSegment
// walking the parent chain, exactly matching the retrieval ACL (allowsCorpusURI).

package usecase

import (
	"context"
	"log/slog"
	"strings"
	"sync/atomic"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
)

// Indexer —— the index-propagation port called from the write path (best-effort,
// never returns an error). nil = Meili not configured, hooks skip directly.
type Indexer interface {
	IndexNote(ctx context.Context, ownerID, noteID string)
	DeleteNote(ctx context.Context, noteID string)
	ReindexOwner(ctx context.Context, ownerID string)
	// Reconcile —— once Meili recovers, backfills writes missed while it was down
	// (dirty flag + full rebuild once healthy). Called periodically by a background loop.
	Reconcile(ctx context.Context, ownerID string)
}

// meiliCorpusIndexer —— the Meili-backed Indexer. Only indexes corpus_notes
// (wiki/output/subjectivity = vault); writings stay on Postgres full-text and never
// enter Meili. dirty: a Meili write failed (while it was down) → reconcile once
// recovered.
type meiliCorpusIndexer struct {
	client *search.Client
	notes  *repo.VaultSyncRepo
	log    *slog.Logger
	dirty  atomic.Bool
}

// NewCorpusIndexer —— constructor. client nil (Meili not configured) → returns nil,
// so Deps.Index ends up nil and hooks skip.
//
//nolint:ireturn // nil-safe factory: client nil returns a nil interface, all write hooks skip
func NewCorpusIndexer(
	client *search.Client, notes *repo.VaultSyncRepo, log *slog.Logger,
) Indexer {
	if client == nil {
		return nil
	}
	return &meiliCorpusIndexer{client: client, notes: notes, log: log}
}

// genreRaw —— raw is the owner's private inbox, privacy-critical: never enters the
// search index.

// genreWriting —— once writing folded into corpus_notes (#151) it shares this table,
// but retrieval still stays on Postgres full-text (lister.Search appends
// searchWritings after the Meili results). Entering Meili too would double-hit, so
// it's skipped.

// skipFromMeili —— whether this genre is excluded from the Meili index: raw (private
// inbox) + writing (stays on PG full-text, to avoid duplicate hits).
func skipFromMeili(genre string) bool {
	return genre == string(entity.GenreRaw) || genre == string(entity.GenreWriting)
}

// IndexNote —— upserts a single corpus note (wiki/output/subjectivity) into Meili.
// genre='raw'/'writing' is skipped outright (raw is a private inbox; writing stays on
// Postgres full-text, and entering Meili would double-hit).
func (x *meiliCorpusIndexer) IndexNote(ctx context.Context, ownerID, noteID string) {
	note, err := x.notes.GetSyncNote(ctx, ownerID, noteID)
	if err != nil {
		x.warn("index note read", err)
		return
	}
	if skipFromMeili(note.Genre) {
		return // raw=private inbox; writing=stays on PG full-text (see skipFromMeili)
	}
	doc := search.Doc{
		ID: note.ID, OwnerID: ownerID, Genre: note.Genre,
		Path:  SyncNotePath(note.Title, note.ParentID, DBParentOf(ctx, x.notes, ownerID)),
		Title: note.Title, Body: note.Body,
		Tags: note.Tags, Published: note.Published, ParentID: note.ParentID,
	}
	if ierr := x.client.Index(ctx, []search.Doc{doc}); ierr != nil {
		x.failed("index note push", ierr)
	}
}

// DeleteNote —— removes one entry from Meili (note deleted/archived).
func (x *meiliCorpusIndexer) DeleteNote(ctx context.Context, noteID string) {
	if err := x.client.Delete(ctx, []string{noteID}); err != nil {
		x.failed("delete note", err)
	}
}

// ReindexOwner —— full rebuild of an owner's index (clear, then build). Used by
// sync / boot backfill / health-recovery reconcile.
func (x *meiliCorpusIndexer) ReindexOwner(ctx context.Context, ownerID string) {
	docs := x.ownerDocs(ctx, ownerID)
	if err := x.client.DeleteOwner(ctx, ownerID); err != nil {
		x.failed("reindex clear", err)
		return
	}
	if err := x.client.Index(ctx, docs); err != nil {
		x.failed("reindex push", err)
	}
}

// Reconcile —— once Meili recovers, backfills writes missed while it was down: dirty
// flag set and healthy → full rebuild from the DB. Clears the dirty flag
// optimistically; if the rebuild fails it gets marked dirty again (retried next
// round). Called periodically by the background wireSearchReconcile.
func (x *meiliCorpusIndexer) Reconcile(ctx context.Context, ownerID string) {
	if !x.dirty.Load() {
		return
	}
	if err := x.client.Healthy(ctx); err != nil {
		return // not recovered yet, leave the dirty flag set and retry next round
	}
	x.dirty.Store(false)
	x.ReindexOwner(ctx, ownerID)
}

// ownerDocs —— all of an owner's corpus_notes (path computed via an in-memory parent
// chain). writings don't enter Meili (stay on PG full-text), so they're excluded.
func (x *meiliCorpusIndexer) ownerDocs(ctx context.Context, ownerID string) []search.Doc {
	notes, err := x.notes.ListAllForExport(ctx, ownerID)
	if err != nil {
		x.warn("reindex list notes", err)
		notes = nil
	}
	byID := make(map[string]*repo.SyncNote, len(notes))
	for i := range notes {
		byID[notes[i].ID] = &notes[i]
	}
	docs := make([]search.Doc, 0, len(notes))
	for i := range notes {
		if skipFromMeili(notes[i].Genre) {
			continue // raw=private inbox; writing=stays on PG full-text (see skipFromMeili)
		}
		path := SyncNotePath(notes[i].Title, notes[i].ParentID, mapParentOf(byID))
		docs = append(docs, search.Doc{
			ID: notes[i].ID, OwnerID: ownerID, Genre: notes[i].Genre,
			Path: path, Title: notes[i].Title, Body: notes[i].Body,
			Tags: notes[i].Tags, Published: notes[i].Published, ParentID: notes[i].ParentID,
		})
	}
	return docs
}

// SyncNotePath —— a corpus note's path: PathSegment-ed parent chain joined by '/',
// **best-effort** (if the parent chain breaks, it stops there and doesn't error —
// indexing/links are best-effort). parentOf supplies "id → (title, parentID)"; the
// DB-backed version passes a GetSyncNote closure, the batch version passes an
// in-memory map closure — one walk implementation, two backings. Shared by index
// propagation and corpus_links, keeping path consistent with the retrieval ACL
// (allowsCorpusURI) — WikiPathByID and friends on the read path are a strict
// variant with different semantics, so they're not merged with this one.
func SyncNotePath(title, parentID string, parentOf func(id string) (string, string, bool)) string {
	segs := []string{PathSegment(title)}
	for cur, depth := parentID, 0; cur != "" && depth < TreeMaxDepth; depth++ {
		pt, pp, ok := parentOf(cur)
		if !ok {
			break
		}
		segs = append([]string{PathSegment(pt)}, segs...)
		cur = pp
	}
	return strings.Join(segs, "/")
}

// DBParentOf —— SyncNotePath's DB-backed implementation: GetSyncNote per parent.
func DBParentOf(
	ctx context.Context, notes *repo.VaultSyncRepo, ownerID string,
) func(string) (string, string, bool) {
	return func(id string) (string, string, bool) {
		n, err := notes.GetSyncNote(ctx, ownerID, id)
		return n.Title, n.ParentID, err == nil
	}
}

// mapParentOf —— SyncNotePath's in-memory implementation: for ReindexOwner's batch
// path, avoids N separate DB queries.
func mapParentOf(byID map[string]*repo.SyncNote) func(string) (string, string, bool) {
	return func(id string) (string, string, bool) {
		n, ok := byID[id]
		if !ok {
			return "", "", false
		}
		return n.Title, n.ParentID, true
	}
}

func (x *meiliCorpusIndexer) warn(msg string, err error) {
	if x.log != nil {
		x.log.Warn("corpus index: "+msg, "err", err)
	}
}

// failed —— a Meili write call failed: logs a warning + marks dirty, so Reconcile
// backfills it once recovered (D4 self-heal).
func (x *meiliCorpusIndexer) failed(msg string, err error) {
	x.dirty.Store(true)
	x.warn(msg, err)
}

// indexNoteHook / deleteNoteHook / reindexOwnerHook —— nil-safe hooks for the write
// path. When Meili isn't configured, deps.Index == nil and they skip directly. Kept
// at this layer so each write/delete usecase calls them explicitly, instead of
// hiding the call inside RebuildNoteRefs.
func indexNoteHook(ctx context.Context, deps Deps, ownerID, noteID string) {
	if deps.Index != nil {
		deps.Index.IndexNote(ctx, ownerID, noteID)
	}
}

func deleteNoteHook(ctx context.Context, deps Deps, noteID string) {
	if deps.Index != nil {
		deps.Index.DeleteNote(ctx, noteID)
	}
}

func reindexOwnerHook(ctx context.Context, deps Deps, ownerID string) {
	if deps.Index != nil {
		deps.Index.ReindexOwner(ctx, ownerID)
	}
}

// ReindexCorpusOwner —— for an outer layer (the sync handler) to fully rebuild the
// index after a batch write. Batching once is cheaper than upserting row-by-row, and
// it reflects vault deletions (full rebuild = delete + build, no drift left behind).
// nil-safe.
func ReindexCorpusOwner(ctx context.Context, deps Deps, ownerID string) {
	reindexOwnerHook(ctx, deps, ownerID)
}

// ReindexCorpusNote —— for an outer layer to propagate after a **single-row** write.
// nil-safe.
//
// Exists because of publish: `seo.set_entry_seo` changes corpus_notes.published, but
// it goes through the owner-side SEO port, not through any write usecase in this
// package — so that note's index document is left stuck at the `published` value
// from whenever it was written. Nobody read that field from the index before, so this
// went unnoticed; after F-D-7, public-identity admission reads exactly that field, so
// a note that just got published would **vanish from retrieval**.
//
// Every field in the index must have its own write path; this one didn't.
func ReindexCorpusNote(ctx context.Context, deps Deps, ownerID, noteID string) {
	indexNoteHook(ctx, deps, ownerID, noteID)
}
