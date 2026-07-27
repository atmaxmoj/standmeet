// corpus_lister_pg_links.go —— pgCorpusLister.Links: corpus_links 的 1 跳 backlinks 检索。
//
// 主体(path)的准入直接复用 Get(denied/not-found 同语义)。邻居顺 note_refs 取 outgoing(本条引用的)
// + backlinks(引用本条的),**每个邻居逐条过 grantedGlobs ACL** —— 这是防泄漏关键:backlinks 那侧,
// 一个越权的源不得因为链到可见条就暴露。note_refs 只连 corpus_notes 且写时已排 self-link,所以这里
// 不必再排自己;dedup 因主键 (src,dst) 唯一、不会重复。只 1 跳:agent 要更深自己对邻居再调。

package corpus

import (
	"context"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// Links —— see file header.
func (l *pgCorpusLister) Links(
	ctx context.Context, ownerID string, scope access.CorpusScope, path string,
) (Links, error) {
	// Get:准入 + 拿 subject id(denied/not-found 透传)
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

func (l *pgCorpusLister) outboundRefs(ctx context.Context, ownerID, id string) []NoteRef {
	if l.noteRefs == nil {
		return []NoteRef{}
	}
	refs, err := l.noteRefs.AdminOutboundFor(ctx, ownerID, id)
	if err != nil {
		return []NoteRef{}
	}
	return refs
}

func (l *pgCorpusLister) backlinkRefs(ctx context.Context, ownerID, id string) []NoteRef {
	if l.noteRefs == nil {
		return []NoteRef{}
	}
	refs, err := l.noteRefs.AdminBacklinksFor(ctx, ownerID, id)
	if err != nil {
		return []NoteRef{}
	}
	return refs
}

// neighborMetas —— 邻居 ref(id+title)→ 补 genre/path → 逐条过 ACL → Meta。越权邻居剔除。
func (l *pgCorpusLister) neighborMetas(
	ctx context.Context, ownerID string, scope access.CorpusScope, refs []NoteRef,
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
	ctx context.Context, ownerID string, scope access.CorpusScope, ref *NoteRef,
) (Meta, bool) {
	if l.queryRepo == nil {
		return Meta{}, false
	}
	note, err := l.queryRepo.GetSyncNote(ctx, ownerID, ref.ID)
	if err != nil {
		return Meta{}, false
	}
	path := SyncNotePath(note.Title, note.ParentID, DBParentOf(ctx, l.queryRepo, ownerID))
	if !allowsCorpusURI(scope, note.Genre, path) {
		return Meta{}, false
	}
	return Meta{ID: ref.ID, Path: path, Title: ref.Title, Genre: note.Genre}, true
}
