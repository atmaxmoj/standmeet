// corpus_lister_pg_links.go —— pgCorpusLister.Links: corpus_links 的 1 跳 backlinks 检索。
//
// 主体(path)的准入直接复用 Get(denied/not-found 同语义)。邻居顺 note_refs 取 outgoing(本条引用的)
// + backlinks(引用本条的),**每个邻居逐条过 grantedGlobs ACL** —— 这是防泄漏关键:backlinks 那侧,
// 一个越权的源不得因为链到可见条就暴露。note_refs 只连 corpus_notes 且写时已排 self-link,所以这里
// 不必再排自己;dedup 因主键 (src,dst) 唯一、不会重复。只 1 跳:agent 要更深自己对邻居再调。

package usecases

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// Links —— see file header.
func (l *pgCorpusLister) Links(
	ctx context.Context, ownerID string, grantedGlobs []string, path string,
) (CorpusLinks, error) {
	// Get:准入 + 拿 subject id(denied/not-found 透传)
	subject, err := l.Get(ctx, ownerID, grantedGlobs, path)
	if err != nil {
		return CorpusLinks{}, err
	}
	out := l.outboundRefs(ctx, ownerID, subject.ID)
	back := l.backlinkRefs(ctx, ownerID, subject.ID)
	return CorpusLinks{
		Outgoing:  l.neighborMetas(ctx, ownerID, grantedGlobs, out),
		Backlinks: l.neighborMetas(ctx, ownerID, grantedGlobs, back),
	}, nil
}

func (l *pgCorpusLister) outboundRefs(ctx context.Context, ownerID, id string) []postgres.NoteRef {
	if l.noteRefs == nil {
		return []postgres.NoteRef{}
	}
	refs, err := l.noteRefs.AdminOutboundFor(ctx, ownerID, id)
	if err != nil {
		return []postgres.NoteRef{}
	}
	return refs
}

func (l *pgCorpusLister) backlinkRefs(ctx context.Context, ownerID, id string) []postgres.NoteRef {
	if l.noteRefs == nil {
		return []postgres.NoteRef{}
	}
	refs, err := l.noteRefs.AdminBacklinksFor(ctx, ownerID, id)
	if err != nil {
		return []postgres.NoteRef{}
	}
	return refs
}

// neighborMetas —— 邻居 ref(id+title)→ 补 genre/path → 逐条过 ACL → CorpusMeta。越权邻居剔除。
func (l *pgCorpusLister) neighborMetas(
	ctx context.Context, ownerID string, grantedGlobs []string, refs []postgres.NoteRef,
) []CorpusMeta {
	out := make([]CorpusMeta, 0, len(refs))
	for i := range refs {
		if m, ok := l.neighborMeta(ctx, ownerID, grantedGlobs, &refs[i]); ok {
			out = append(out, m)
		}
	}
	return out
}

func (l *pgCorpusLister) neighborMeta(
	ctx context.Context, ownerID string, grantedGlobs []string, ref *postgres.NoteRef,
) (CorpusMeta, bool) {
	if l.queryRepo == nil {
		return CorpusMeta{}, false
	}
	note, err := l.queryRepo.GetSyncNote(ctx, ownerID, ref.ID)
	if err != nil {
		return CorpusMeta{}, false
	}
	path := syncNotePath(note.Title, note.ParentID, dbParentOf(ctx, l.queryRepo, ownerID))
	if !allowsCorpusURI(grantedGlobs, note.Genre, path) {
		return CorpusMeta{}, false
	}
	return CorpusMeta{ID: ref.ID, Path: path, Title: ref.Title, Genre: note.Genre}, true
}
