// sync.go —— sync face 入口。vault 文件批 → corpus_notes 多-genre 节点树(raw 折进 genre='raw')。
// 路由:顶层 folder → genre(wiki/subjectivity/raw;output 无 folder = promote-derived;未知/根裸
// 文件跳过)。跳 hidden(dotdir/_templates)。reconcile:按 title 认领(跨 genre,支持 move);basename
// 在本 vault 不唯一时改按 source_path 认(同名文件各占各行,F-L-2)→ upsert;web-wins(owner 在 web
// 改过不覆盖);未变则 skip。链接整批解析。
// 删:取决于 SyncMode —— authoritative(整个 vault)会 prune 掉不在这批里的 vault-imported note
// (sync 就是让 corpus 等于 vault,F-L-6);partial(子集上传)绝不删。见 sync_prune.go。

package obsidian

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/postgres"
)

const (
	genreWiki         = "wiki"
	genreSubjectivity = "subjectivity"
	genreRaw          = "raw"
	genreWriting      = "writing"
)

var corpGenres = map[string]bool{genreWiki: true, genreSubjectivity: true}

// IsVaultTopFolder —— 顶层 folder 是否是被同步的 genre。route layer 用它判 webkitRelativePath
// 的首段是「vault 文件夹名」(要剥)还是「genre」(要留);两种上传形态都能正确路由。
func IsVaultTopFolder(seg string) bool {
	return seg == genreWiki || seg == genreSubjectivity || seg == genreRaw ||
		seg == genreWriting || seg == "writings"
}

// SyncNotesPort —— corp note reconcile(跨 genre)。VaultSyncRepo 实现。
// GetByTitle 没认领到 → postgres.ErrSyncNoteNotFound。
type SyncNotesPort interface {
	GetByTitle(ctx context.Context, ownerID, title string) (postgres.SyncNote, error)
	GetBySourcePath(ctx context.Context, ownerID, sourcePath string) (postgres.SyncNote, error)
	Create(ctx context.Context, in *postgres.CreateSyncNoteInput) (string, error)
	Update(ctx context.Context, in *postgres.UpdateSyncNoteInput) error
	// PruneAbsentVaultNotes —— drop vault-imported notes not in keepIDs (F-L-6, authoritative).
	PruneAbsentVaultNotes(ctx context.Context, ownerID string, keepIDs []string) (int, error)
}

// SyncRefsPort —— 一条 note 的 body 里 `[[links]]` → note_refs(整批后解析)。
type SyncRefsPort interface {
	RebuildForNote(ctx context.Context, ownerID, noteID, body string) error
}

// SyncWritingsPort —— writing/ 子树(含附件)→ writings 表(复用旧 ImportVault flatten-import)。
type SyncWritingsPort interface {
	ImportWritings(ctx context.Context, ownerID string, files []VaultFile) ImportResult
}

// SyncDeps —— sync face 依赖。Refs / Writings / CSS 可为 nil(可选)。
type SyncDeps struct {
	Notes    SyncNotesPort
	Refs     SyncRefsPort
	Writings SyncWritingsPort
	CSS      SyncCSSPort
}

// SyncVault —— sync face 主入口。mode says whether the upload is the whole vault (prune what's
// absent) or a subset (never delete) — see SyncMode.
func SyncVault(
	ctx context.Context, deps *SyncDeps, ownerID string, files []VaultFile, mode SyncMode,
) ImportResult {
	result := ImportResult{Errors: []string{}}
	b := classifyVault(files)
	syncWritings(ctx, deps, ownerID, b.writing, &result)
	syncCSS(ctx, deps, ownerID, b.css)
	tree := buildDesiredTree(b.corp)
	st := &syncState{
		ownerID: ownerID, idOf: map[string]string{}, titleToID: map[string]string{},
		dupTitles: collidingTitles(tree),
	}
	for _, node := range tree {
		reconcileNode(ctx, deps, node, st, &result)
	}
	resolveLinks(ctx, deps, st, tree)
	pruneAbsent(ctx, deps, st, mode, &result)
	return result
}

// syncWritings —— writing/ 子树(含附件)交给 writings importer,统计并进总结果。
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
	result.Errors = append(result.Errors, wr.Errors...)
}

// syncState —— 一次 sync 的可变状态:节点 path→id(算 parent)+ title→id(链接解析)。
type syncState struct {
	idOf      map[string]string
	titleToID map[string]string
	dupTitles map[string]bool // lowercased titles shared by >1 node → ambiguous, rejected
	ownerID   string
}

// collidingTitles —— titles shared by more than one materializing node in this vault. Reconcile
// claims BY TITLE (assuming basenames are unique); a shared title is ambiguous (can't tell a
// genre-move from two distinct notes) so it must be rejected, not silently collapsed onto one row.
func collidingTitles(tree []*desiredNode) map[string]bool {
	seen := map[string]int{}
	for _, n := range tree {
		if shouldMaterialize(n) {
			seen[strings.ToLower(n.title)]++
		}
	}
	dup := map[string]bool{}
	for title, count := range seen {
		if count > 1 {
			dup[title] = true
		}
	}
	return dup
}

// nodeContent —— 一个节点的落库内容;file==nil(自动补的中间节点)= 空结构节点。
type nodeContent struct {
	body       string
	excerpt    string
	srcPath    string
	tags       []string
	cssClasses []string
	published  bool
}

func contentOf(n *desiredNode) nodeContent {
	if n.file == nil {
		return nodeContent{}
	}
	return nodeContent{
		body: n.file.body, excerpt: n.file.fm.Excerpt, srcPath: n.file.sourcePath,
		tags: n.file.fm.Tags, cssClasses: n.file.fm.CSSClasses, published: n.file.fm.Publish,
	}
}

// shouldMaterialize —— 结构节点(有子)总落库;leaf 仅 publish:true 落 —— publish:false 无子 → 跳。
// raw + subjectivity 例外:两者都是 owner 私有的**grounding 素材**(subjectivity 是 raw-form leaf,
// 只是内容是 standpoint;"grounded but not cited by default"),永不 publish-gated,故总落库 —— 否则
// 私有的主观性笔记永远进不来、agent 无从 ground(F-L-3)。
func shouldMaterialize(n *desiredNode) bool {
	return n.hasChildren || n.genre == genreRaw || n.genre == genreSubjectivity ||
		(n.file != nil && n.file.fm.Publish)
}

// inboxSourceFor —— genre='raw' 的节点带 vault 来源标签 "obsidian:<srcPath>";其它 genre 空。
// 落进 corpus_notes.inbox_source(vault raw 幂等 upsert 的 conflict key)。
func inboxSourceFor(genre string, c *nodeContent) string {
	if genre == genreRaw && c.srcPath != "" {
		return "obsidian:" + c.srcPath
	}
	return ""
}

// nodeOp —— reconcile 一个节点的参数包(避开 argument-limit)。
type nodeOp struct {
	deps   *SyncDeps
	node   *desiredNode
	st     *syncState
	result *ImportResult
	c      *nodeContent
	parent *string
}

// reconcileSkip —— pre-reconcile guard: a non-materializing node is skipped. (Duplicate basenames
// are no longer rejected — Obsidian allows the same basename in different folders; the reconcile
// claims those by source_path instead of title, see claimExisting.) Returns true when it handled
// the node (caller returns without reconciling).
func reconcileSkip(node *desiredNode, result *ImportResult) bool {
	if !shouldMaterialize(node) {
		result.Skipped++
		return true
	}
	return false
}

// claimExisting —— reconcile 认领同一条 note 的入口。默认按 title 认(跨 genre,支持 move)。
// 但 title 在本 vault 不唯一时(不同文件夹同名文件),title 认领会把它们塌成一条 —— 改按
// source_path 认(文件路径唯一),让同名文件各占各行(schema 本来就是这么设计的:见
// obsidian_source_path 注释 + corpus_notes_source_path_idx)。结构节点(无 file → source_path 空)
// 永远按 title 认(空路径会互撞)。
func claimExisting(
	ctx context.Context, deps *SyncDeps, node *desiredNode, st *syncState,
) (postgres.SyncNote, error) {
	if st.dupTitles[strings.ToLower(node.title)] && node.file != nil && node.file.sourcePath != "" {
		note, err := deps.Notes.GetBySourcePath(ctx, st.ownerID, node.file.sourcePath)
		return note, wrapClaim(err)
	}
	note, err := deps.Notes.GetByTitle(ctx, st.ownerID, node.title)
	return note, wrapClaim(err)
}

// wrapClaim —— 包认领错误(满足 wrapcheck),但透传 ErrSyncNoteNotFound sentinel 不变
// (reconcileNode 用 errors.Is 判它当「新建」信号;%w 也能 Is 到,但留原样更省心)。
func wrapClaim(err error) error {
	if err == nil || errors.Is(err, postgres.ErrSyncNoteNotFound) {
		return err
	}
	return fmt.Errorf("claim existing note: %w", err)
}

func reconcileNode(
	ctx context.Context, deps *SyncDeps, node *desiredNode, st *syncState, result *ImportResult,
) {
	if reconcileSkip(node, result) {
		return
	}
	existing, err := claimExisting(ctx, deps, node, st)
	c := contentOf(node)
	op := &nodeOp{
		deps: deps, node: node, st: st, result: result, c: &c, parent: parentIDOf(st, node),
	}
	switch {
	case errors.Is(err, postgres.ErrSyncNoteNotFound):
		createNode(ctx, op)
	case err != nil:
		result.Errors = append(result.Errors, node.title+": "+err.Error())
	default:
		updateNode(ctx, op, &existing)
	}
}

func createNode(ctx context.Context, op *nodeOp) {
	id, err := op.deps.Notes.Create(ctx, &postgres.CreateSyncNoteInput{
		OwnerID: op.st.ownerID, Genre: op.node.genre, ParentID: op.parent, Title: op.node.title,
		Body: op.c.body, Excerpt: op.c.excerpt, Tags: op.c.tags, Published: op.c.published,
		SourcePath: op.c.srcPath, CSSClasses: op.c.cssClasses,
		InboxSource: inboxSourceFor(op.node.genre, op.c),
	})
	if err != nil {
		op.result.Errors = append(op.result.Errors, op.node.title+": "+err.Error())
		return
	}
	record(op.st, op.node, id)
	op.result.Created++
}

func updateNode(ctx context.Context, op *nodeOp, existing *postgres.SyncNote) {
	record(op.st, op.node, existing.ID) // always index for link resolution + child parenting
	if webEdited(existing) || unchangedNode(existing, op.node, op.parent, op.c) {
		op.result.Skipped++
		return
	}
	if err := op.deps.Notes.Update(ctx, &postgres.UpdateSyncNoteInput{
		ID: existing.ID, OwnerID: op.st.ownerID, Genre: op.node.genre, ParentID: op.parent,
		Body: op.c.body, Excerpt: op.c.excerpt, Tags: op.c.tags, Published: op.c.published,
		SourcePath: op.c.srcPath, CSSClasses: op.c.cssClasses,
		InboxSource: inboxSourceFor(op.node.genre, op.c),
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
	st.titleToID[node.title] = id
}

// webEdited —— 上次 sync 后 owner 在 web 又改过 → 不覆盖。create/update 同一条语句里把 updated_at 与
// imported_at 都设成同一个 now(),故二者相等;web 端 PATCH 之后 updated_at 才严格晚于 imported_at。
func webEdited(sn *postgres.SyncNote) bool {
	return sn.HasImported && sn.UpdatedAt.After(sn.ImportedAt)
}

func unchangedNode(sn *postgres.SyncNote, n *desiredNode, parent *string, c *nodeContent) bool {
	return unchangedFields(sn, c) && sn.Genre == n.genre &&
		sameParent(sn.ParentID, parent) && sameStrings(sn.Tags, c.tags)
}

// unchangedFields —— the scalar-content fields (body / excerpt / publish) are unchanged.
func unchangedFields(sn *postgres.SyncNote, c *nodeContent) bool {
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
	id, ok := st.titleToID[node.title]
	if !ok {
		return
	}
	// best-effort:链接解析失败不该让整批 sync 失败。
	if err := deps.Refs.RebuildForNote(ctx, st.ownerID, id, node.file.body); err != nil {
		return
	}
}
