// corpus_lister_pg_links.go —— pgCorpusLister.Links: 1-hop backlinks lookup over corpus_links.
//
// Admission for the subject (path) reuses Get directly (same denied/not-found semantics).
// Neighbors come from note_refs: outgoing (what this entry references) + backlinks (what
// references this entry). **Each neighbor is individually checked against grantedGlobs ACL**
// — this is the anti-leak key: on the backlinks side, an entry the caller isn't authorized
// for must not be exposed just because it links to a visible one. note_refs only connects
// corpus_notes and already excludes self-links at write time, so there's no need to exclude
// self here again; dedup happens for free since the (src,dst) primary key is unique. Only
// 1 hop: an agent that wants to go deeper calls again on the neighbors itself.

package usecase

import (
	"context"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// Links —— see file header.
func (l *pgCorpusLister) Links(
	ctx context.Context, ownerID string, scope access.CorpusScope, path string,
) (Links, error) {
	// Get: admission + fetch subject id (denied/not-found propagate through)
	subject, err := l.Get(ctx, ownerID, scope, path)
	if err != nil {
		return Links{}, err
	}
	out := l.outboundRefs(ctx, ownerID, subject.ID)
	back := l.backlinkRefs(ctx, ownerID, subject.ID)
	return Links{
		Outgoing:  l.neighborMetas(ctx, ownerID, scope, out),
		Backlinks: l.neighborMetas(ctx, ownerID, scope, back),
	}, nil
}

func (l *pgCorpusLister) outboundRefs(ctx context.Context, ownerID, id string) []repo.NoteRef {
	if l.noteRefs == nil {
		return []repo.NoteRef{}
	}
	refs, err := l.noteRefs.AdminOutboundFor(ctx, ownerID, id)
	if err != nil {
		return []repo.NoteRef{}
	}
	return refs
}

func (l *pgCorpusLister) backlinkRefs(ctx context.Context, ownerID, id string) []repo.NoteRef {
	if l.noteRefs == nil {
		return []repo.NoteRef{}
	}
	refs, err := l.noteRefs.AdminBacklinksFor(ctx, ownerID, id)
	if err != nil {
		return []repo.NoteRef{}
	}
	return refs
}

// neighborMetas —— neighbor ref (id+title) → fill in genre/path → check ACL per
// entry → Meta. Unauthorized neighbors are dropped.
func (l *pgCorpusLister) neighborMetas(
	ctx context.Context, ownerID string, scope access.CorpusScope, refs []repo.NoteRef,
) []Meta {
	out := make([]Meta, 0, len(refs))
	for i := range refs {
		if m, ok := l.neighborMeta(ctx, ownerID, scope, &refs[i]); ok {
			out = append(out, m)
		}
	}
	return out
}

func (l *pgCorpusLister) neighborMeta(
	ctx context.Context, ownerID string, scope access.CorpusScope, ref *repo.NoteRef,
) (Meta, bool) {
	if l.queryRepo == nil {
		return Meta{}, false
	}
	note, err := l.queryRepo.GetSyncNote(ctx, ownerID, ref.ID)
	if err != nil {
		return Meta{}, false
	}
	path := SyncNotePath(note.Title, note.ParentID, DBParentOf(ctx, l.queryRepo, ownerID))
	if !allowsCorpusEntry(scope, note.Genre, path, note.Published) {
		return Meta{}, false
	}
	return Meta{ID: ref.ID, Path: path, Title: ref.Title, Genre: note.Genre}, true
}
