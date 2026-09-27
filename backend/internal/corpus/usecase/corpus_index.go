// corpus_index.go —— corpus → Meili index propagation (the 1b crawl face).
//
// Postgres is the source of truth; Meili is a derived projection. No write path calls this:
// the corpus_notes trigger records every change as a corpus.note.changed event, and the
// corpus.index subscriber (internal/corpus/subscriber) calls the Indexer from a durable job.
// A failure is therefore returned, not swallowed — the job layer retries it on its backoff until
// Meili answers, across restarts. Path is computed via PathSegment walking the parent chain,
// exactly matching the retrieval ACL (allowsCorpusURI).

package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
)

// Indexer —— the index writes the corpus.index subscriber makes. Every method returns its error:
// the caller is a job, and a returned error is a retry.
type Indexer interface {
	IndexNote(ctx context.Context, ownerID, noteID string) error
	// IndexSubtree re-indexes a note and every descendant: their paths change with its title or
	// parent.
	IndexSubtree(ctx context.Context, ownerID, noteID string) error
	DeleteNote(ctx context.Context, noteID string) error
	ReindexOwner(ctx context.Context, ownerID string) error
}

// IndexReceipt —— what a write can tell its caller about the index: indexed=true once the
// search index holds the write (waited for briefly), otherwise the job carrying it.
type IndexReceipt interface {
	Await(ctx context.Context, noteID string) (indexed bool, jobID int64)
}

// SoleOwnerID —— gets this instance's owner id (a narrow port: this domain doesn't know the
// owner domain). An unclaimed instance returns "", not an error: nothing to index yet.
type SoleOwnerID func(ctx context.Context) (string, error)

// meiliCorpusIndexer —— the Meili-backed Indexer. Only indexes corpus_notes
// (wiki/output/subjectivity = vault); raw and writings never enter Meili.
type meiliCorpusIndexer struct {
	client *search.Client
	notes  *repo.VaultSyncRepo
}

// NewCorpusIndexer —— constructor. client nil (Meili not configured) → returns nil.
//
//nolint:ireturn // nil-safe factory: client nil returns a nil interface
func NewCorpusIndexer(client *search.Client, notes *repo.VaultSyncRepo) Indexer {
	if client == nil {
		return nil
	}
	return &meiliCorpusIndexer{client: client, notes: notes}
}

// skipFromMeili —— raw is the owner's private inbox and never enters the search index;
// writing stays on Postgres full-text (lister.Search appends it), so indexing it would double-hit.
func skipFromMeili(genre string) bool {
	return genre == string(entity.GenreRaw) || genre == string(entity.GenreWriting)
}

// IndexNote —— upserts a single corpus note (wiki/output/subjectivity) into Meili. A note that
// no longer exists is removed instead (the event outran a delete).
func (x *meiliCorpusIndexer) IndexNote(ctx context.Context, ownerID, noteID string) error {
	note, err := x.notes.GetSyncNote(ctx, ownerID, noteID)
	if err != nil {
		if errors.Is(err, repo.ErrSyncNoteNotFound) {
			return x.DeleteNote(ctx, noteID)
		}
		return fmt.Errorf("index note read: %w", err)
	}
	if skipFromMeili(note.Genre) {
		return nil
	}
	doc := search.Doc{
		ID: note.ID, OwnerID: ownerID, Genre: note.Genre,
		Path:  SyncNotePath(note.Title, note.ParentID, DBParentOf(ctx, x.notes, ownerID)),
		Title: note.Title, Body: note.Body,
		Tags: note.Tags, Published: note.Published, ParentID: note.ParentID,
	}
	if err = x.client.Index(ctx, []search.Doc{doc}); err != nil {
		return fmt.Errorf("index note push: %w", err)
	}
	return nil
}

// IndexSubtree —— the note plus every descendant, from one in-memory read of the owner's notes.
func (x *meiliCorpusIndexer) IndexSubtree(ctx context.Context, ownerID, noteID string) error {
	docs, err := x.ownerDocs(ctx, ownerID)
	if err != nil {
		return err
	}
	sub := subtreeDocs(docs, noteID)
	if len(sub) == 0 {
		return x.IndexNote(ctx, ownerID, noteID) // raw/writing, or gone: the single path decides
	}
	if err = x.client.Index(ctx, sub); err != nil {
		return fmt.Errorf("index subtree push: %w", err)
	}
	return nil
}

// subtreeDocs —— the docs whose parent chain reaches rootID (rootID's own doc included).
func subtreeDocs(docs []search.Doc, rootID string) []search.Doc {
	parent := make(map[string]string, len(docs))
	for i := range docs {
		parent[docs[i].ID] = docs[i].ParentID
	}
	sub := make([]search.Doc, 0, len(docs))
	for i := range docs {
		if withinSubtree(parent, docs[i].ID, rootID) {
			sub = append(sub, docs[i])
		}
	}
	return sub
}

// withinSubtree —— whether walking id's parent chain (at most TreeMaxDepth steps) reaches rootID.
func withinSubtree(parent map[string]string, id, rootID string) bool {
	for cur, depth := id, 0; cur != "" && depth <= TreeMaxDepth; depth++ {
		if cur == rootID {
			return true
		}
		cur = parent[cur]
	}
	return false
}

// DeleteNote —— removes one entry from Meili (note deleted/archived).
func (x *meiliCorpusIndexer) DeleteNote(ctx context.Context, noteID string) error {
	if err := x.client.Delete(ctx, []string{noteID}); err != nil {
		return fmt.Errorf("delete note: %w", err)
	}
	return nil
}

// ReindexOwner —— full rebuild of an owner's index (clear, then build). Run as a job at boot, so
// an index that lost its volume or missed changes before the bus existed is brought up to date.
func (x *meiliCorpusIndexer) ReindexOwner(ctx context.Context, ownerID string) error {
	docs, err := x.ownerDocs(ctx, ownerID)
	if err != nil {
		return err
	}
	if err = x.client.DeleteOwner(ctx, ownerID); err != nil {
		return fmt.Errorf("reindex clear: %w", err)
	}
	if err = x.client.Index(ctx, docs); err != nil {
		return fmt.Errorf("reindex push: %w", err)
	}
	return nil
}

// ownerDocs —— all of an owner's indexable corpus_notes (path computed via an in-memory parent
// chain).
func (x *meiliCorpusIndexer) ownerDocs(ctx context.Context, ownerID string) ([]search.Doc, error) {
	notes, err := x.notes.ListAllForExport(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("reindex list notes: %w", err)
	}
	byID := make(map[string]*repo.SyncNote, len(notes))
	for i := range notes {
		byID[notes[i].ID] = &notes[i]
	}
	docs := make([]search.Doc, 0, len(notes))
	for i := range notes {
		if skipFromMeili(notes[i].Genre) {
			continue
		}
		path := SyncNotePath(notes[i].Title, notes[i].ParentID, mapParentOf(byID))
		docs = append(docs, search.Doc{
			ID: notes[i].ID, OwnerID: ownerID, Genre: notes[i].Genre,
			Path: path, Title: notes[i].Title, Body: notes[i].Body,
			Tags: notes[i].Tags, Published: notes[i].Published, ParentID: notes[i].ParentID,
		})
	}
	return docs, nil
}

// SyncNotePath —— a corpus note's path: PathSegment-ed parent chain joined by '/',
// **best-effort** (if the parent chain breaks, it stops there and doesn't error).
// parentOf supplies "id → (title, parentID)"; the DB-backed version passes a GetSyncNote
// closure, the batch version passes an in-memory map closure — one walk implementation, two
// backings. The SQL twin (corpus_note_uri, used by the event trigger) must agree; see
// TestSQLPathSegmentMatchesGo.
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

// mapParentOf —— SyncNotePath's in-memory implementation.
func mapParentOf(byID map[string]*repo.SyncNote) func(string) (string, string, bool) {
	return func(id string) (string, string, bool) {
		n, ok := byID[id]
		if !ok {
			return "", "", false
		}
		return n.Title, n.ParentID, true
	}
}
