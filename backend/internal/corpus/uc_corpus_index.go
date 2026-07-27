// corpus_index.go —— corpus → Meili 索引传播(1b crawl face)。
//
// Postgres 是 source-of-truth,Meili 是派生投影。写路径把变更同步进 Meili:promote/update/publish →
// IndexNote(单条 upsert),delete → DeleteNote,sync/backfill/reconcile → ReindexOwner(整批重建)。
// **best-effort**:index 失败只记 warn,绝不让 corpus 写失败(Postgres 已落即事实成立;Meili 事后由
// 健康恢复时的 reconcile 补上)。path 用 PathSegment 走父链算,与检索 ACL(allowsCorpusURI)完全一致。

package corpus

import (
	"context"
	"log/slog"
	"strings"
	"sync/atomic"

	"github.com/atmaxmoj/standmeet/internal/infra/search"
)

// Indexer —— 写路径调用的索引传播口(best-effort,不返错)。nil = 未配 Meili,hooks 直接跳过。
type Indexer interface {
	IndexNote(ctx context.Context, ownerID, noteID string)
	DeleteNote(ctx context.Context, noteID string)
	ReindexOwner(ctx context.Context, ownerID string)
	// Reconcile —— Meili 恢复后补齐 down 期间漏索引的写(有脏标记 + 健康时整批重建)。后台循环定期调。
	Reconcile(ctx context.Context, ownerID string)
}

// meiliCorpusIndexer —— Meili 后端的 Indexer。只索引 corpus_notes(wiki/output/subjectivity =
// vault);writings 留在 Postgres 全文,不进 Meili。dirty:有过 Meili 写失败(down 期间)→ 恢复后 reconcile。
type meiliCorpusIndexer struct {
	client *search.Client
	notes  *VaultSyncRepo
	log    *slog.Logger
	dirty  atomic.Bool
}

// NewCorpusIndexer —— 构造。client nil(未配 Meili)→ 返 nil,让 Deps.Index 为 nil、hooks 跳过。
//
//nolint:ireturn // nil-safe factory:client nil 返 nil 接口,写 hooks 全跳过
func NewCorpusIndexer(
	client *search.Client, notes *VaultSyncRepo, log *slog.Logger,
) Indexer {
	if client == nil {
		return nil
	}
	return &meiliCorpusIndexer{client: client, notes: notes, log: log}
}

// genreRaw —— raw 是 owner 私有 inbox,privacy-critical:绝不进搜索索引。

// genreWriting —— writing 折进 corpus_notes(#151)后同住本表,但检索仍留在 Postgres 全文
// (lister.Search 在 Meili 结果后 append searchWritings)。若也进 Meili 会重复命中,故跳过。

// skipFromMeili —— 该 genre 是否排除出 Meili 索引:raw(私有 inbox)+ writing(留 PG 全文,避免重复)。
func skipFromMeili(genre string) bool {
	return genre == genreRaw || genre == genreWriting
}

// IndexNote —— 单条 corpus note(wiki/output/subjectivity)upsert 进 Meili。genre='raw'/'writing'
// 直接跳过(raw 是私有 inbox;writing 留 Postgres 全文,进 Meili 会重复命中)。
func (x *meiliCorpusIndexer) IndexNote(ctx context.Context, ownerID, noteID string) {
	note, err := x.notes.GetSyncNote(ctx, ownerID, noteID)
	if err != nil {
		x.warn("index note read", err)
		return
	}
	if skipFromMeili(note.Genre) {
		return // raw=私有 inbox; writing=留 PG 全文(见 skipFromMeili)
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

// DeleteNote —— 从 Meili 删一条(note 删/归档)。
func (x *meiliCorpusIndexer) DeleteNote(ctx context.Context, noteID string) {
	if err := x.client.Delete(ctx, []string{noteID}); err != nil {
		x.failed("delete note", err)
	}
}

// ReindexOwner —— 整批重建 owner 的 index(先清后建)。sync / boot 回填 / 健康恢复 reconcile 用。
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

// Reconcile —— Meili 恢复后补齐 down 期间漏的写:有脏标记且健康 → 从 DB 整批重建。乐观清脏,
// 重建再失败会重新置脏(下轮再试)。后台 wireSearchReconcile 定期调。
func (x *meiliCorpusIndexer) Reconcile(ctx context.Context, ownerID string) {
	if !x.dirty.Load() {
		return
	}
	if err := x.client.Healthy(ctx); err != nil {
		return // 还没恢复,留着脏标记下轮再试
	}
	x.dirty.Store(false)
	x.ReindexOwner(ctx, ownerID)
}

// ownerDocs —— owner 全部 corpus_notes(内存父链算 path)。writings 不进 Meili(留 PG 全文),故不含。
func (x *meiliCorpusIndexer) ownerDocs(ctx context.Context, ownerID string) []search.Doc {
	notes, err := x.notes.ListAllForExport(ctx, ownerID)
	if err != nil {
		x.warn("reindex list notes", err)
		notes = nil
	}
	byID := make(map[string]*SyncNote, len(notes))
	for i := range notes {
		byID[notes[i].ID] = &notes[i]
	}
	docs := make([]search.Doc, 0, len(notes))
	for i := range notes {
		if skipFromMeili(notes[i].Genre) {
			continue // raw=私有 inbox; writing=留 PG 全文(见 skipFromMeili)
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

// SyncNotePath —— corpus note 的 path:PathSegment 父链 '/' 连,**best-effort**(父链断了就到此为止,
// 不报错——索引/links 是尽力而为)。parentOf 提供「某 id → (title, parentID)」;走库版传 GetSyncNote
// 闭包、批量版传内存 map 闭包 —— walk 逻辑一处,两种 backing。索引传播 + corpus_links 共用,保证
// path 与检索 ACL(allowsCorpusURI)一致(读路径的 WikiPathByID 等是 strict 版、语义不同,故不合并)。
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

// DBParentOf —— SyncNotePath 的走库 backing:逐父 GetSyncNote。
func DBParentOf(
	ctx context.Context, notes *VaultSyncRepo, ownerID string,
) func(string) (string, string, bool) {
	return func(id string) (string, string, bool) {
		n, err := notes.GetSyncNote(ctx, ownerID, id)
		return n.Title, n.ParentID, err == nil
	}
}

// mapParentOf —— SyncNotePath 的内存 backing:ReindexOwner 批量,免 N 次查库。
func mapParentOf(byID map[string]*SyncNote) func(string) (string, string, bool) {
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

// failed —— Meili 写调用失败:记 warn + 置脏,让 Reconcile 在恢复后补上(D4 self-heal)。
func (x *meiliCorpusIndexer) failed(msg string, err error) {
	x.dirty.Store(true)
	x.warn(msg, err)
}

// indexNoteHook / deleteNoteHook / reindexOwnerHook —— 写路径的 nil-safe 钩子。未配 Meili 时
// deps.Index == nil 直接跳过。放这层让每个 write/delete usecase 显式调,不藏进 RebuildNoteRefs。
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

// ReindexCorpusOwner —— 供外层(sync handler)在批量写后整批重建 index。batch 一次比逐条 upsert
// 划算,且能反映 vault 删除(整批重建 = 删+建,漂移不留)。nil-safe。
func ReindexCorpusOwner(ctx context.Context, deps Deps, ownerID string) {
	reindexOwnerHook(ctx, deps, ownerID)
}
