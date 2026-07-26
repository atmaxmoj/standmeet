// import.go —— vault 目录的批量 ingest。route layer 接 multipart 上传（owner
// 通过 webkitdirectory 选了整个 vault），解出 .md + attachment 两类文件，
// 这里把每个 .md 转换成 usecases.SaveWriting 调用。
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

	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/usecases"
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
	Errors  []string
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
	ctx context.Context, deps usecases.WritingsTxDeps, writingRepoSetter MetaSetter,
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
	Deps        usecases.WritingsTxDeps
	Setter      MetaSetter
	MD          *VaultFile
	Attachments map[string]VaultFile
	Result      *ImportResult
	OwnerID     string
}

// MetaSetter —— SaveWriting 之后标记这行是从 vault 来的。
// 实现：postgres.WritingRepo.{GetByObsidianSourcePath, GetBySlug, SetObsidianMeta}。
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
		SourcePath: a.MD.RelPath, Parsed: &parsed,
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
	Deps       usecases.WritingsTxDeps
	Setter     MetaSetter
	Parsed     *parsedVault
	OwnerID    string
	SourcePath string
}

func upsertFromVault(ctx context.Context, a *upsertArgs) (upsertOutcome, error) {
	existing, found := findWriting(ctx, a)
	outcome := outcomeUpdated
	if !found {
		outcome = outcomeCreated
	}
	if err := runSaveAndMark(ctx, a, &existing); err != nil {
		return outcomeSkipped, err
	}
	return outcome, nil
}

func runSaveAndMark(ctx context.Context, a *upsertArgs, existing *corpus.Writing) error {
	in := buildSaveInputFromVault(a.OwnerID, existing, a.SourcePath, a.Parsed)
	writing, serr := usecases.SaveWriting(ctx, a.Deps, &in)
	if serr != nil {
		return fmt.Errorf("save writing: %w", serr)
	}
	if merr := a.Setter.SetObsidianMeta(ctx, a.OwnerID, writing.ID(), a.SourcePath); merr != nil {
		return fmt.Errorf("set obsidian meta: %w", merr)
	}
	return nil
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
) usecases.SaveWritingInput {
	slug := pickSlug(p.fm.Slug, sourcePath)
	in := usecases.SaveWritingInput{
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
