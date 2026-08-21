// import.go —— vault 目录的批量 ingest。route layer 接 multipart 上传（owner
// 通过 webkitdirectory 选了整个 vault），解出 .md + attachment 两类文件，
// 这里把每个 .md 转换成 corpus.SaveWriting 调用。
//
// 流程：
//   1. 按 .md / 非 .md 分类；非 .md 按 basename 入 attachment 索引
//   2. 每个 .md：
//      a. 解 frontmatter；publish != true 跳过
//      b. body 里的 image ref → 在 attachment 索引找 bytes → 生成
//         pending-<uuid> 当 SaveWriting 的 PendingID
//      c. 改写 body 里 image ref 成 standmeet-asset:pending-<uuid>
//      d. 看 owner 的 writings 里有没有同 obsidian_source_path / 同 slug 的：
//         认到就 update，认不到就 create（vault 是 single live source：没有 web-wins，
//         web 上改过的要留就先 export 回 vault 再同步）
//      e. SetObsidianMeta(source_path) 标记 imported_at
//   3. 返 ImportResult 给 caller 让 UI 显示统计

package obsidian

import (
	"context"
	"errors"
	"fmt"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// VaultFile —— multipart 上传的一个文件。RelPath 是 vault 内相对路径
// （webkitdirectory 取的 webkitRelativePath）；route layer 解出来传给这里。
type VaultFile struct {
	RelPath string
	Body    []byte
}

// ImportResult —— 一批 import 的统计。
// fieldalignment: slice (24B) 先，int 后。
type ImportResult struct {
	Errors []string
	// Notices —— 收下了,但有话要说。多语结构坏掉的笔记走这条路:同步是**镜像**,拒收等于
	// owner 丢内容;可是一条读者只看得到半篇的笔记必须在面板上说出来 —— 不然它跟一个
	// 起不来又不打日志的沙箱是同一种沉默。
	Notices []string
	// Kept —— 这一批**对上号了**的行的 id（现在只有 writings 这条路填它）。
	//
	// 剪枝的判据是「vault 导入过、又不在 keep 里 → vault 删掉了它」。而 writings 走的是
	// 跟 corp 树完全不同的一条路,以前它对上了号却不往 keep 里报 —— 于是同一次整份导入
	// 刚建好的 writing,几十毫秒后被自己的剪枝删掉,真语料上 `genre='writing'` 的行数
	// 长期是 0,回执还每次都写 `1 new · 1 deleted`（F-L-63）。
	//
	// 规矩因此是：**任何一条对行做认领的路,都必须往这里报**。
	Kept    []string
	Created int
	Updated int
	Skipped int
	// Deleted —— notes removed because they are gone from the vault (authoritative sync, F-L-6).
	// Always 0 for a partial upload and for ImportVault (writings), which never delete.
	Deleted int
}

// ImportVault —— route layer 主入口。owner 通过 multipart 上传整个 vault，
// 这里 ingest 所有带 publish: true 的 .md。
func ImportVault(
	ctx context.Context, deps corpus.WritingsTxDeps, writingRepoSetter MetaSetter,
	ownerID string, files []VaultFile,
) ImportResult {
	parts := partitionFiles(files)
	result := ImportResult{}
	for i := range parts.mds {
		processOne(ctx, &processArgs{
			Deps: deps, Setter: writingRepoSetter, OwnerID: ownerID,
			MD: &parts.mds[i], Attachments: parts.attachments, Result: &result,
		})
	}
	return result
}

// processArgs —— processOne 参数打包（避开 argument-limit 5）。
type processArgs struct {
	Deps        corpus.WritingsTxDeps
	Setter      MetaSetter
	MD          *VaultFile
	Attachments map[string]VaultFile
	Result      *ImportResult
	OwnerID     string
}

// MetaSetter —— SaveWriting 之后标记这行是从 vault 来的。
// 实现：corpus.WritingRepo.{GetByObsidianSourcePath, GetBySlug, SetObsidianMeta}。
type MetaSetter interface {
	GetByObsidianSourcePath(
		ctx context.Context, ownerID, sourcePath string,
	) (corpus.Writing, error)
	GetBySlug(ctx context.Context, ownerID, slug string) (corpus.Writing, error)
	SetObsidianMeta(ctx context.Context, ownerID, writingID, sourcePath string) error
}

// partitionedVault —— partitionFiles 多返回打包（避开 funcresult-limit +
// named return）。fieldalignment: map (1 ptr 8B) 先，slice (3 ptr 24B) 后。
type partitionedVault struct {
	attachments map[string]VaultFile
	mds         []VaultFile
}

func partitionFiles(files []VaultFile) partitionedVault {
	out := partitionedVault{
		mds:         make([]VaultFile, 0),
		attachments: make(map[string]VaultFile, 0),
	}
	for i := range files {
		f := &files[i]
		if strings.HasSuffix(strings.ToLower(f.RelPath), ".md") {
			out.mds = append(out.mds, *f)
			continue
		}
		// basename 索引：Obsidian 解析 [[image.png]] 是按 basename 找的，
		// 不管在 vault 哪个子目录。
		base := basename(f.RelPath)
		out.attachments[base] = *f
	}
	return out
}

func basename(rel string) string {
	if i := strings.LastIndex(rel, "/"); i >= 0 {
		return rel[i+1:]
	}
	return rel
}

func processOne(ctx context.Context, a *processArgs) {
	parsed, perr := parseVaultMarkdown(a.MD, a.Attachments)
	if perr != nil {
		a.Result.Errors = append(a.Result.Errors, a.MD.RelPath+": "+perr.Error())
		return
	}
	if !parsed.fm.Publish {
		a.Result.Skipped++
		return
	}
	saved, err := upsertFromVault(ctx, &upsertArgs{
		Deps: a.Deps, Setter: a.Setter, OwnerID: a.OwnerID,
		SourcePath: a.MD.RelPath, Parsed: &parsed, Result: a.Result,
	})
	finalizeResult(a.Result, a.MD.RelPath, saved, err)
}

func finalizeResult(result *ImportResult, path string, saved upsertOutcome, err error) {
	if err != nil {
		result.Errors = append(result.Errors, path+": "+err.Error())
		return
	}
	incrementOutcome(result, saved)
}

// incrementOutcome —— map-lookup 降 finalizeResult 的 cyclomatic。
// 用 map 而不是 switch + default 是因为 default 跟 outcomeSkipped 返同样
// pointer，identical-switch-branches lint 报错；map 形式无 switch。
func incrementOutcome(result *ImportResult, saved upsertOutcome) {
	counters := map[upsertOutcome]*int{
		outcomeCreated: &result.Created,
		outcomeUpdated: &result.Updated,
		outcomeSkipped: &result.Skipped,
	}
	if c, ok := counters[saved]; ok {
		*c++
		return
	}
	// 不在 enum 里（不会到，但兜底当 skipped）。
	result.Skipped++
}

type upsertOutcome int

const (
	outcomeCreated upsertOutcome = iota
	outcomeUpdated
	outcomeSkipped
)

// parsedVault / parseVaultMarkdown / rewriteBodyAttachments / resolveCoverRef
// 在 import_parse.go 里实现，跨多个文件 share 但 namespace 同包。

// upsertArgs —— upsertFromVault 参数打包（避开 argument-limit 5 + hugeParam）。
type upsertArgs struct {
	Deps   corpus.WritingsTxDeps
	Setter MetaSetter
	Parsed *parsedVault
	// Result —— 这一批的统计。writing 落到哪一行也记在这里（`Kept`）：**对上号了却不报，
	// 剪枝就会把它当成"vault 里没有的东西"删掉**（F-L-63）。
	Result     *ImportResult
	OwnerID    string
	SourcePath string
}

func upsertFromVault(ctx context.Context, a *upsertArgs) (upsertOutcome, error) {
	existing, found := findWriting(ctx, a)
	outcome := outcomeUpdated
	if !found {
		outcome = outcomeCreated
	}
	wrote, err := runSaveAndMark(ctx, a, &existing)
	if err != nil {
		return outcomeSkipped, err
	}
	if !wrote {
		return outcomeSkipped, nil // 一字未变 → 这次是 unchanged,不是 updated（F-L-64）
	}
	return outcome, nil
}

// runSaveAndMark —— 存这一条并盖上 vault 的戳。返回 false = 内容一字未变,这次没写。
func runSaveAndMark(ctx context.Context, a *upsertArgs, existing *corpus.Writing) (bool, error) {
	in := buildSaveInputFromVault(a.OwnerID, existing, a.SourcePath, a.Parsed)
	if existing.ID() != "" && unchangedWriting(existing, &in) {
		// 没变就别写（F-L-64）。**但仍然要报进 Kept** —— 它这一趟确实对上号了,
		// 不报的话紧接着的剪枝会把它当成 vault 里已经没有的东西删掉（F-L-63）。
		a.Result.Kept = append(a.Result.Kept, existing.ID())
		return false, nil
	}
	writing, serr := corpus.SaveWriting(ctx, a.Deps, &in)
	if serr != nil {
		return false, fmt.Errorf("save writing: %w", serr)
	}
	if merr := a.Setter.SetObsidianMeta(ctx, a.OwnerID, writing.ID(), a.SourcePath); merr != nil {
		return false, fmt.Errorf("set obsidian meta: %w", merr)
	}
	// **报出这一行的 id**：这条 writing 这一趟对上号了,剪枝必须放过它。上一句刚给它盖上
	// "vault 导入"的戳,而剪枝删的正是"盖了戳又不在 keep 里"的行 —— 不报就是自己删自己。
	a.Result.Kept = append(a.Result.Kept, writing.ID())
	return true, nil
}

func lookupExistingWriting(
	ctx context.Context, setter MetaSetter, ownerID, sourcePath string,
) (corpus.Writing, bool) {
	w, err := setter.GetByObsidianSourcePath(ctx, ownerID, sourcePath)
	if err != nil {
		if errors.Is(err, corpus.ErrWritingNotFound) {
			return corpus.Writing{}, false
		}
		return corpus.Writing{}, false
	}
	return w, true
}

// findWriting —— 先按 source_path 认领;认不到再按 slug(move/rename → source_path 变但 slug 稳)。
func findWriting(ctx context.Context, a *upsertArgs) (corpus.Writing, bool) {
	if w, found := lookupExistingWriting(ctx, a.Setter, a.OwnerID, a.SourcePath); found {
		return w, true
	}
	return lookupWritingBySlug(ctx, a.Setter, a.OwnerID, pickSlug(a.Parsed.fm.Slug, a.SourcePath))
}

// lookupWritingBySlug —— source_path 没认到时按 slug 认(move/rename 的稳定身份)。
func lookupWritingBySlug(
	ctx context.Context, setter MetaSetter, ownerID, slug string,
) (corpus.Writing, bool) {
	if slug == "" {
		return corpus.Writing{}, false
	}
	w, err := setter.GetBySlug(ctx, ownerID, slug)
	if err != nil {
		return corpus.Writing{}, false
	}
	return w, true
}

func buildSaveInputFromVault(
	ownerID string, existing *corpus.Writing, sourcePath string, p *parsedVault,
) corpus.SaveWritingInput {
	slug := pickSlug(p.fm.Slug, sourcePath)
	in := corpus.SaveWritingInput{
		OwnerID: ownerID, WritingID: existing.ID(), Slug: slug,
		Title:         pickTitle(p.fm.Title, slug),
		Excerpt:       p.fm.Excerpt,
		BodyMD:        p.body,
		CoverHeadline: p.fm.CoverHeadline,

		CoverHue:      pickHue(p.fm.CoverHue),
		CoverImageRef: p.cover,
		Visibility:    pickVisibility(p.fm.Visibility),
		LockedBody:    p.fm.LockedBody,
		Tags:          p.fm.Tags,
		CrossRefs:     []string{},
		Files:         p.files,
		Publish:       p.fm.Publish,
	}
	return in
}

func pickSlug(fmSlug, sourcePath string) string {
	if fmSlug != "" {
		return fmSlug
	}
	base := basename(sourcePath)
	return strings.TrimSuffix(base, ".md")
}

func pickTitle(fmTitle, slug string) string {
	if fmTitle != "" {
		return fmTitle
	}
	return slug
}

func pickHue(h string) string {
	switch h {
	case corpus.WritingCoverHueAmber, corpus.WritingCoverHueViolet,
		corpus.WritingCoverHueAcid:
		return h
	}
	return corpus.WritingCoverHueAmber
}

func pickVisibility(v string) string {
	if v == corpus.WritingVisibilityPrivate {
		return corpus.WritingVisibilityPrivate
	}
	return corpus.WritingVisibilityPublic
}
