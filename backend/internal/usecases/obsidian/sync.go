// sync.go —— sync face 入口。vault 文件批 → corpus_notes 多-genre 节点树 + raw inbox。
// 路由:顶层 folder → genre(wiki/subjectivity/raw;output 无 folder = promote-derived;未知/根裸
// 文件跳过)。跳 hidden(dotdir/_templates)。reconcile:按 title 认领(basename 全 vault 唯一) →
// upsert;web-wins(owner 在 web 改过不覆盖);未变则 skip;**绝不删**没在这批里的。链接整批解析。

package obsidian

import (
	"context"
	"errors"
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
	Create(ctx context.Context, in *postgres.CreateSyncNoteInput) (string, error)
	Update(ctx context.Context, in *postgres.UpdateSyncNoteInput) error
}

// SyncRawPort —— raw inbox 同步(按 source_path 幂等 upsert)。
type SyncRawPort interface {
	UpsertFromVault(ctx context.Context, ownerID, sourcePath, body string, tags []string) error
}

// SyncRefsPort —— 一条 note 的 body 里 `[[links]]` → note_refs(整批后解析)。
type SyncRefsPort interface {
	RebuildForNote(ctx context.Context, ownerID, noteID, body string) error
}

// SyncDeps —— sync face 依赖。Refs 可为 nil(链接解析可选)。
type SyncDeps struct {
	Notes SyncNotesPort
	Raw   SyncRawPort
	Refs  SyncRefsPort
}

// SyncVault —— sync face 主入口。
func SyncVault(ctx context.Context, deps SyncDeps, ownerID string, files []VaultFile) ImportResult {
	result := ImportResult{Errors: []string{}}
	corp, raw := classifyVault(files)
	syncRaw(ctx, deps, ownerID, raw, &result)
	tree := buildDesiredTree(corp)
	st := &syncState{ownerID: ownerID, idOf: map[string]string{}, titleToID: map[string]string{}}
	for _, node := range tree {
		reconcileNode(ctx, deps, node, st, &result)
	}
	resolveLinks(ctx, deps, st, tree)
	return result
}

// syncState —— 一次 sync 的可变状态:节点 path→id(算 parent)+ title→id(链接解析)。
type syncState struct {
	idOf      map[string]string
	titleToID map[string]string
	ownerID   string
}

// fileRoute —— 一个文件的路由结果;ok=false 表示跳过(hidden/非-md/根裸文件/未知顶层)。
type fileRoute struct {
	genre string
	segs  []string
	ok    bool
}

func isSyncableMarkdown(rel string) bool {
	return !isHiddenPath(rel) && strings.HasSuffix(strings.ToLower(rel), ".md")
}

func isSyncGenre(g string) bool { return g == genreRaw || corpGenres[g] }

// routeFile —— 判文件路由到哪个 genre(跳 hidden/非-md/根裸文件/未知顶层)。
func routeFile(rel string) fileRoute {
	if !isSyncableMarkdown(rel) {
		return fileRoute{}
	}
	segs := strings.Split(rel, "/")
	if len(segs) < 2 || !isSyncGenre(segs[0]) {
		return fileRoute{}
	}
	return fileRoute{genre: segs[0], segs: segs, ok: true}
}

// classifyVault —— 过滤 hidden/非-md;按顶层 folder 分流 corp(wiki/subjectivity)与 raw。
func classifyVault(files []VaultFile) ([]vaultNote, []VaultFile) {
	corp := []vaultNote{}
	raw := []VaultFile{}
	for i := range files {
		rt := routeFile(files[i].RelPath)
		switch {
		case !rt.ok:
			continue
		case rt.genre == genreRaw:
			raw = append(raw, files[i])
		default:
			corp = append(corp, toVaultNote(&files[i], rt.segs))
		}
	}
	return corp, raw
}

func toVaultNote(f *VaultFile, segs []string) vaultNote {
	p := parseCorpNote(f.Body)
	return vaultNote{
		genre: segs[0], sourcePath: f.RelPath, fm: p.fm, body: p.body,
		segs: normalizeSegs(segs[1:]),
	}
}

// normalizeSegs —— 去文件名的 .md;空格 → 连字符(normalize-names 容忍)。
func normalizeSegs(segs []string) []string {
	out := make([]string, len(segs))
	for i := range segs {
		s := segs[i]
		if i == len(segs)-1 {
			s = strings.TrimSuffix(s, ".md")
		}
		out[i] = strings.ReplaceAll(s, " ", "-")
	}
	return out
}

// isHiddenPath —— 任一路径段以 . 开头,或是 _templates → 跳过。
func isHiddenPath(rel string) bool {
	for seg := range strings.SplitSeq(rel, "/") {
		if seg == "_templates" || (seg != "" && seg[0] == '.') {
			return true
		}
	}
	return false
}

// nodeContent —— 一个节点的落库内容;file==nil(自动补的中间节点)= 空结构节点。
type nodeContent struct {
	body      string
	srcPath   string
	tags      []string
	published bool
}

func contentOf(n *desiredNode) nodeContent {
	if n.file == nil {
		return nodeContent{}
	}
	return nodeContent{
		body: n.file.body, srcPath: n.file.sourcePath,
		tags: n.file.fm.Tags, published: n.file.fm.Publish,
	}
}

// shouldMaterialize —— 结构节点(有子)总落库;leaf 仅 publish:true 落 —— publish:false 无子 → 跳。
func shouldMaterialize(n *desiredNode) bool {
	return n.hasChildren || (n.file != nil && n.file.fm.Publish)
}

// nodeOp —— reconcile 一个节点的参数包(避开 argument-limit)。
type nodeOp struct {
	deps   SyncDeps
	node   *desiredNode
	st     *syncState
	result *ImportResult
	c      *nodeContent
	parent *string
}

func reconcileNode(
	ctx context.Context, deps SyncDeps, node *desiredNode, st *syncState, result *ImportResult,
) {
	if !shouldMaterialize(node) {
		result.Skipped++
		return
	}
	existing, err := deps.Notes.GetByTitle(ctx, st.ownerID, node.title)
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
		Body: op.c.body, Tags: op.c.tags, Published: op.c.published, SourcePath: op.c.srcPath,
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
		Body: op.c.body, Tags: op.c.tags, Published: op.c.published, SourcePath: op.c.srcPath,
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
	return sn.Body == c.body && sn.Published == c.published && sn.Genre == n.genre &&
		sameParent(sn.ParentID, parent) && sameStrings(sn.Tags, c.tags)
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

func syncRaw(
	ctx context.Context, deps SyncDeps, ownerID string, raw []VaultFile, result *ImportResult,
) {
	if deps.Raw == nil {
		return
	}
	for i := range raw {
		p := parseCorpNote(raw[i].Body)
		err := deps.Raw.UpsertFromVault(ctx, ownerID, raw[i].RelPath, p.body, p.fm.Tags)
		if err != nil {
			result.Errors = append(result.Errors, raw[i].RelPath+": "+err.Error())
		}
	}
}

func resolveLinks(ctx context.Context, deps SyncDeps, st *syncState, tree []*desiredNode) {
	if deps.Refs == nil {
		return
	}
	for _, node := range tree {
		resolveNoteLinks(ctx, deps, st, node)
	}
}

func resolveNoteLinks(ctx context.Context, deps SyncDeps, st *syncState, node *desiredNode) {
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
