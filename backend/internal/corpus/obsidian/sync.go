// sync.go —— sync face 入口。vault 文件批 → corpus_notes 多-genre 节点树(raw 折进 genre='raw')。
// 路由:顶层 folder → genre(wiki/subjectivity/raw;output 无 folder = promote-derived;未知/根裸
// 文件跳过)。跳 hidden(dotdir/_templates)。reconcile:按 title 认领(跨 genre,支持 move);basename
// 不唯一时改按 source_path 认(同名文件各占各行,F-L-2)→ upsert;未变则 skip。链接整批解析。
// 「唯一不唯一」问的是**语料**,不是这一批上传(F-L-61,见 sync_ambiguity.go)。
//
// **vault 是 single live source**(见 vault-ingestion 决策):sync 就是让 destination 等于 source,
// 没有"谁 wins" —— web 上改过的不会把自己钉住对抗 vault,要留就先 export 回 vault 再同步(F-L-6)。
//
// 落库 ≠ 公开(F-L-8):路由进来的 .md 一律落库;frontmatter 的 `publish` 只喂 DB 的 `published`
// (旧名 seo_indexed)=「匿名访客可见 / 进 sitemap」,published=false 是「要 code 才能看」,不是
// 「不存在」。两者曾被同一个 flag 绑死,代价是 owner 想喂给 agent ground 就必须同时公开给全网。
//
// 删:取决于 SyncMode —— authoritative(整个 vault)会 prune 掉不在这批里的 vault-imported note
// (sync 就是让 corpus 等于 vault,F-L-6);partial(子集上传)绝不删。见 sync_prune.go。

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

// IsVaultTopFolder —— 顶层 folder 是否是被同步的 genre。route layer 用它判 webkitRelativePath
// 的首段是「vault 文件夹名」(要剥)还是「genre」(要留);两种上传形态都能正确路由。
func IsVaultTopFolder(seg string) bool {
	return seg == genreWiki || seg == genreSubjectivity || seg == genreRaw ||
		seg == genreWriting || seg == "writings"
}

// SyncNotesPort —— corp note reconcile(跨 genre)。VaultSyncRepo 实现。
// GetByTitle 没认领到 → corpus.ErrSyncNoteNotFound。
type SyncNotesPort interface {
	GetByTitle(ctx context.Context, ownerID, title string) (corpus.SyncNote, error)
	GetBySourcePath(ctx context.Context, ownerID, sourcePath string) (corpus.SyncNote, error)
	// DuplicateTitles —— 语料里已经重名的标题(跨 genre,小写)。按 title 认领之前先问它。
	DuplicateTitles(ctx context.Context, ownerID string) ([]string, error)
	// GetByTitleInGenre —— 只在一个 genre 里按 title 认。结构节点(无 source_path)的身份。
	GetByTitleInGenre(ctx context.Context, ownerID, genre, title string) (corpus.SyncNote, error)
	Create(ctx context.Context, in *corpus.CreateSyncNoteInput) (string, error)
	Update(ctx context.Context, in *corpus.UpdateSyncNoteInput) error
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
	// 先问语料哪些标题有歧义,再动手。问不出来就整批不做:不知道歧义在哪还按 title 认领,
	// 等于拿别的 genre 里的笔记当赌注(见 sync_ambiguity.go)。
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
	// Kept 也要并过来 —— 那是剪枝放过谁的依据（F-L-63）。丢掉这一句,这一批 writing
	// 就会被同一次请求里的剪枝当成「vault 里已经没有的东西」删掉。
	result.Kept = append(result.Kept, wr.Kept...)
	result.Errors = append(result.Errors, wr.Errors...)
}

// syncState —— 一次 sync 的可变状态：节点 (genre,path)→id。算父链和挂链接**共用同一份身份**。
//
// 这里以前还有一张 `titleToID`（只有链接解析读它）。它被删掉而不是留着：vault 的 basename
// 不唯一，按 title 找笔记必然张冠李戴，而一份「按不唯一的键索引」的表放在那里，早晚还会
// 有人去读第二次（F-L-60）。
type syncState struct {
	idOf      map[string]string
	dupTitles map[string]bool // lowercased titles that are ambiguous → claim by source_path
	ownerID   string
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

// claimExisting —— reconcile 认领同一条 note 的入口。默认按 title 认(跨 genre,支持 move)。
// 但 title 有歧义时(不同文件夹的同名文件 —— 语料里已经这样,或这批上传里就这样),按 title 认
// 就是抓阄,输的那条可能住在别的 genre。歧义集合怎么算见 sync_ambiguity.go;有歧义时改用
// 两把更细的尺子,按节点有没有文件分:
//
//   - 有文件 → 按 source_path 认(文件路径唯一),同名文件各占各行(schema 本来就是这么设计的:
//     见 obsidian_source_path 注释 + corpus_notes_source_path_idx)。
//   - 结构节点(文件夹占位,source_path 是空的,空路径会互撞)→ 在**自己这个 genre 里**按 title
//     认:它的身份就是「自己那棵树上的那个文件夹」。真 vault 里 raw/math/ 和 wiki/math/ 并存
//     是常态,跨 genre 认会把一棵树的文件夹拖进另一个 genre(F-L-61)。
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

// wrapClaim —— 包认领错误(满足 wrapcheck),但透传 ErrSyncNoteNotFound sentinel 不变
// (reconcileNode 用 errors.Is 判它当「新建」信号;%w 也能 Is 到,但留原样更省心)。
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
	// vault 没提 publish → 沿用这条现有的值,别把「没说」当成「说不」(F-L-22)。要在比对**之前**
	// 填,否则一条只差发布位的 note 会被判成 changed,然后拿那个不作数的 false 覆盖过去。
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
	// **按路径找这条笔记，不按标题**（F-L-60）。
	//
	// 账：这里原来是 `st.titleToID[node.title]` —— 而 vault 里 basename 根本不唯一
	// （`theory/theory.md` 在三个文件夹里各有一份）。同名的几篇共用一个桶，而
	// `RebuildForNote(id, body)` 是**重建**：后处理的那篇把前一篇刚建好的边整个盖掉，
	// 轮到最后那篇恰好没链接，桶就空了。prod 上量到的代价：同名笔记 97 条，只有 22 条
	// 有出边，**41 条正文里有 `[[` 却一条边都没有** —— 而 vault 自己的 check-links.sh
	// 说这些链接全是好的，损失只发生在我们这一侧、且不报错。
	//
	// reconcile 那一半早就改成按 `source_path` 认领了（F-L-2），链接这一半没跟上：
	// 一个能力两个面，只修了一个面。`st.idOf` 就是那份按 (genre, path) 索引的表，
	// 算父链一直用的是它。
	id, ok := st.idOf[nodeKey(node.genre, node.path)]
	if !ok {
		return
	}
	// best-effort:链接解析失败不该让整批 sync 失败。
	if err := deps.Refs.RebuildForNote(ctx, st.ownerID, id, node.file.body); err != nil {
		return
	}
}

// marshalLabels —— lang-labels → jsonb 字节。空表 / 编不动 → nil(仓储那侧落成 `{}`)。
// 编不动就当没写:一份切换器标签值不了让整条笔记同步失败。
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

// noteI18nNotices —— 这条笔记的多语结构有没有话要说。
//
// **同步照收**:它是镜像,拒收等于 owner 在 vault 里写的东西进不来。但一条只渲染得出半篇的
// 笔记不能悄悄进来 —— 诊断挂在结果上,面板会印出来,owner 才知道去改哪一条。
func noteI18nNotices(result *ImportResult, title string, c *nodeContent) {
	ds := i18n.Validate(&i18n.Frontmatter{Lang: c.lang}, c.body)
	for i := range ds {
		result.Notices = append(result.Notices, title+": "+ds[i].Message)
	}
}
