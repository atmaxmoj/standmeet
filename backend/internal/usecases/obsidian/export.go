// export.go —— 把 owner 所有 writing 渲成 .md + frontmatter，连带 attachment
// 一起打包成 zip。route layer 直接 stream 这个 zip 给 browser 下载。
//
// 形态（zip 内）：
//   writings/<slug>.md     —— frontmatter + body（image ref 已 rewrite 成
//                            attachments/<asset-id>.<ext> 形态，portable）
//   attachments/<id>.<ext> —— body / cover 引用的所有 asset blob
//
// Obsidian 解压进 vault：每篇 writing 是 `<slug>.md`，所有图片在
// `attachments/` 子目录。owner 可以直接在 Obsidian 里看到、编辑、用 graph
// view 浏览。

package obsidian

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"mime"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/storage"
)

// ExportDeps —— 流式 zip writer 要的 backend hooks。
type ExportDeps struct {
	Writings *postgres.WritingRepo
	Assets   *postgres.AssetRepo
	Storage  *storage.Client
	Corpus   *postgres.VaultSyncRepo // corp note(wiki/subjectivity/output)反向渲染
}

// initialWrittenCap —— 单 owner 多 writing 共享 attachment dedup map 的初始容量。
const initialWrittenCap = 16

// WriteZip —— 全部 owner 的 writing + 关联 attachment 写进 zip。w 通常是
// http.ResponseWriter（route layer 调）。stream 模式，不落临时文件。
func WriteZip(ctx context.Context, deps ExportDeps, ownerID string, w io.Writer) error {
	writings, err := deps.Writings.ListByOwner(ctx, ownerID)
	if err != nil {
		return fmt.Errorf("list writings for export: %w", err)
	}
	zw := zip.NewWriter(w)
	written := make(map[string]struct{}, initialWrittenCap)
	if werr := writeAllWritings(ctx, deps, zw, writings, written); werr != nil {
		return closeAfterErr(zw, werr)
	}
	if cerr := writeCorpusIfSet(ctx, deps, zw, ownerID); cerr != nil {
		return closeAfterErr(zw, cerr)
	}
	if cerr := zw.Close(); cerr != nil {
		return fmt.Errorf("close zip: %w", cerr)
	}
	return nil
}

// writeCorpusIfSet —— 有 corpus repo 时把 corp note 也写进 zip(admin export)。
func writeCorpusIfSet(ctx context.Context, deps ExportDeps, zw *zip.Writer, ownerID string) error {
	if deps.Corpus == nil {
		return nil
	}
	notes, err := deps.Corpus.ListAllForExport(ctx, ownerID)
	if err != nil {
		return fmt.Errorf("list corpus for export: %w", err)
	}
	return writeCorpusNotes(notes, zw)
}

func closeAfterErr(zw *zip.Writer, err error) error {
	if cerr := zw.Close(); cerr != nil {
		_ = cerr
	}
	return err
}

func writeAllWritings(
	ctx context.Context, deps ExportDeps, zw *zip.Writer,
	writings []corpusdomain.Writing, written map[string]struct{},
) error {
	for i := range writings {
		if err := writeOneWriting(ctx, deps, zw, &writings[i], written); err != nil {
			return err
		}
	}
	return nil
}

func writeOneWriting(
	ctx context.Context, deps ExportDeps, zw *zip.Writer,
	writing *corpusdomain.Writing, written map[string]struct{},
) error {
	wid := writing.ID()
	assets, aerr := deps.Assets.ListByHolder(ctx, wid)
	if aerr != nil {
		return fmt.Errorf("list assets for writing %s: %w", wid, aerr)
	}
	filenames := buildAttachmentFilenames(assets)
	if err := writeAttachments(ctx, &writeAttachmentsArgs{
		Zw: zw, Writings: deps.Writings, Assets: deps.Assets, Storage: deps.Storage,
		Filenames: filenames, Written: written, AssetList: assets,
	}); err != nil {
		return err
	}
	return writeWritingMarkdown(zw, writing, filenames)
}

// buildAttachmentFilenames —— 每张 asset 的 zip 内 filename。命名规则：
// `<asset-id>.<ext>`，ext 从 content-type 推。用 asset-id 而不是原始 filename
// 保证 zip 内 unique（owner 上传两张同名图也不撞）。
func buildAttachmentFilenames(assets []corpusdomain.Asset) map[string]string {
	out := make(map[string]string, len(assets))
	for i := range assets {
		ext := extFromContentType(assets[i].ContentType)
		out[assets[i].ID] = assets[i].ID + ext
	}
	return out
}

// canonicalExt —— 常见类型的规范扩展名。mime.ExtensionsByType 按字母序返回,`image/jpeg`
// 会给 `.jpe`(不是 `.jpg`)、`text/markdown` 也乱,round-trip 名字就漂了。先查这张表。
var canonicalExt = map[string]string{
	"image/jpeg":       ".jpg",
	"image/png":        ".png",
	"image/gif":        ".gif",
	"image/webp":       ".webp",
	"image/svg+xml":    ".svg",
	"image/avif":       ".avif",
	"application/pdf":  ".pdf",
	"text/markdown":    ".md",
	"text/plain":       ".txt",
	"text/csv":         ".csv",
	"application/json": ".json",
}

func extFromContentType(ct string) string {
	base := ct
	if before, _, found := strings.Cut(ct, ";"); found { // 剥 "; charset=..." 参数
		base = strings.TrimSpace(before)
	}
	if e, ok := canonicalExt[strings.ToLower(base)]; ok {
		return e
	}
	exts, err := mime.ExtensionsByType(base)
	if err != nil || len(exts) == 0 {
		return ".bin"
	}
	return exts[0]
}

// writeAttachmentsArgs —— writeAttachments 参数打包（避开 argument-limit 5）。
// fieldalignment: 把 ExportDeps (3 个 pointer) 内嵌进来扁平化，避开 nested
// struct 的 padding overhead。
type writeAttachmentsArgs struct {
	Zw        *zip.Writer
	Writings  *postgres.WritingRepo
	Assets    *postgres.AssetRepo
	Storage   *storage.Client
	Filenames map[string]string
	Written   map[string]struct{}
	AssetList []corpusdomain.Asset
}

func writeAttachments(ctx context.Context, a *writeAttachmentsArgs) error {
	for i := range a.AssetList {
		key := a.AssetList[i].StorageKey
		if _, dup := a.Written[key]; dup {
			continue
		}
		a.Written[key] = struct{}{}
		if err := writeOneAttachment(ctx, &writeOneArgs{
			Zw: a.Zw, Storage: a.Storage,
			Asset: &a.AssetList[i], Filenames: a.Filenames,
		}); err != nil {
			return err
		}
	}
	return nil
}

// writeOneArgs —— writeOneAttachment 参数包（避开 argument-limit 5）。
type writeOneArgs struct {
	Zw        *zip.Writer
	Storage   *storage.Client
	Asset     *corpusdomain.Asset
	Filenames map[string]string
}

func writeOneAttachment(ctx context.Context, w *writeOneArgs) error {
	body, gerr := w.Storage.Get(ctx, w.Asset.StorageKey)
	if gerr != nil {
		return fmt.Errorf("download asset %s: %w", w.Asset.ID, gerr)
	}
	entry, eerr := w.Zw.Create("attachments/" + w.Filenames[w.Asset.ID])
	if eerr != nil {
		return fmt.Errorf("zip attachment entry: %w", eerr)
	}
	if _, werr := entry.Write(body); werr != nil {
		return fmt.Errorf("write attachment %s: %w", w.Asset.ID, werr)
	}
	return nil
}

func writeWritingMarkdown(
	zw *zip.Writer, writing *corpusdomain.Writing, filenames map[string]string,
) error {
	body := RewriteToVaultPath(writing.Body(), filenames)
	fm := writingToFrontmatter(writing, filenames)
	content, aerr := AssembleMarkdown(&fm, body)
	if aerr != nil {
		return aerr
	}
	slug := writing.Slug()
	entry, cerr := zw.Create("writings/" + slug + ".md")
	if cerr != nil {
		return fmt.Errorf("zip writing entry: %w", cerr)
	}
	if _, werr := entry.Write([]byte(content)); werr != nil {
		return fmt.Errorf("write writing %s: %w", slug, werr)
	}
	return nil
}

// writingToFrontmatter —— Writing struct → Obsidian frontmatter。cover_image
// 字段引用 attachments/<filename> 形态，让 Obsidian 能直接展示。
func writingToFrontmatter(w *corpusdomain.Writing, filenames map[string]string) Frontmatter {
	fm := Frontmatter{
		Title: w.Title(), Slug: w.Slug(),
		Excerpt: w.Excerpt(), Tags: w.Tags(),
		CoverHeadline: w.CoverHeadline(),
		CoverHue:      w.CoverHue(), Visibility: w.VisibilityMode(),
		LockedBody: w.LockedBody(), Publish: w.IsPublished(),
	}
	// 时间戳不进 frontmatter:created_at / published_at 由 DB 拥有,import 侧也不读。
	addCoverImageRef(&fm, w, filenames)
	return fm
}

func addCoverImageRef(fm *Frontmatter, w *corpusdomain.Writing, filenames map[string]string) {
	assetID := w.CoverImageAssetID()
	if assetID == "" {
		return
	}
	name, ok := filenames[assetID]
	if !ok {
		return
	}
	// frontmatter 里写 cover_image 当 custom field（Obsidian 显示成 text；
	// Obsidian 1.4+ 不会把它当 image embed 渲，但 export/import round-trip 完
	// 整无损）。
	addCoverImageField(fm, "attachments/"+name)
}

// addCoverImageField —— 通过给 frontmatter 加一个非 typed field 来 carry
// cover_image。我们的 Frontmatter struct 静态字段没有 cover_image，需要
// 拼到 LockedBody 之外的位置，这里用一个 ad-hoc 后处理：在 RenderFrontmatter
// 输出后插一行。最简单的形态是直接在 frontmatter struct 加 CoverImage 字段。
// 这里走加字段的路（修一次 frontmatter.go 即可，跟其它 custom field 一样）。
//
// 注意：此函数只更新 fm.CoverImage（在 frontmatter.go 加的字段）。
func addCoverImageField(fm *Frontmatter, path string) {
	fm.CoverImage = path
}
