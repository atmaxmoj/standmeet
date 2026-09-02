// export.go -- renders every owner writing to .md + frontmatter, bundled
// with attachments, into a zip. The route layer streams this zip straight
// to the browser for download.
//
// Shape (inside the zip):
//   writings/<slug>.md     -- frontmatter + body (image refs already
//                            rewritten to attachments/<asset-id>.<ext>
//                            form, portable)
//   attachments/<id>.<ext> -- every asset blob referenced by body / cover
//
// Unzipped into an Obsidian vault: each writing is `<slug>.md`, all images
// live under the `attachments/` subdirectory. The owner can view, edit, and
// browse it with graph view directly in Obsidian.

package obsidian

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"mime"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
)

// ExportDeps -- backend hooks needed by the streaming zip writer.
type ExportDeps struct {
	Writings *corpus.WritingRepo
	Assets   *corpus.AssetRepo
	Storage  *storage.Client
	Corpus   *corpus.VaultSyncRepo // corp notes (wiki/subjectivity/output), rendered back
}

// initialWrittenCap -- initial capacity of the attachment dedup map shared
// across a single owner's writings.
const initialWrittenCap = 16

// WriteZip -- writes all of an owner's writings plus their attachments into
// a zip. w is usually an http.ResponseWriter (called by the route layer).
// Streaming mode, no temp file on disk.
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

// writeCorpusIfSet -- when a corpus repo is set, also write corp notes into
// the zip (admin export).
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
	writings []corpus.Writing, written map[string]struct{},
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
	writing *corpus.Writing, written map[string]struct{},
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

// buildAttachmentFilenames -- the in-zip filename for each asset. Naming
// rule: `<asset-id>.<ext>`, ext inferred from content-type. Using asset-id
// instead of the original filename guarantees uniqueness inside the zip
// (two images the owner uploaded under the same name still won't collide).
func buildAttachmentFilenames(assets []corpus.Asset) map[string]string {
	out := make(map[string]string, len(assets))
	for i := range assets {
		ext := extFromContentType(assets[i].ContentType)
		out[assets[i].ID] = assets[i].ID + ext
	}
	return out
}

// canonicalExt -- canonical extensions for common types. mime.ExtensionsByType
// returns results alphabetically, so `image/jpeg` yields `.jpe` (not
// `.jpg`), and `text/markdown` is wrong too -- names would drift across a
// round-trip. Check this table first.
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
	if before, _, found := strings.Cut(ct, ";"); found { // strip the "; charset=..." parameter
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

// writeAttachmentsArgs -- bundles writeAttachments' arguments (to stay
// under the argument-limit-5 lint). fieldalignment: flattens ExportDeps's 3
// pointers in directly, avoiding nested-struct padding overhead.
type writeAttachmentsArgs struct {
	Zw        *zip.Writer
	Writings  *corpus.WritingRepo
	Assets    *corpus.AssetRepo
	Storage   *storage.Client
	Filenames map[string]string
	Written   map[string]struct{}
	AssetList []corpus.Asset
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

// writeOneArgs -- argument bundle for writeOneAttachment (to stay under the
// argument-limit-5 lint).
type writeOneArgs struct {
	Zw        *zip.Writer
	Storage   *storage.Client
	Asset     *corpus.Asset
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
	zw *zip.Writer, writing *corpus.Writing, filenames map[string]string,
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

// writingToFrontmatter -- Writing struct -> Obsidian frontmatter. The
// cover_image field references the attachments/<filename> form so Obsidian
// can render it directly.
func writingToFrontmatter(w *corpus.Writing, filenames map[string]string) Frontmatter {
	fm := Frontmatter{
		Title: w.Title(), Slug: w.Slug(),
		Excerpt: w.Excerpt(), Tags: w.Tags(),
		CoverHeadline: w.CoverHeadline(),
		CoverHue:      w.CoverHue(), Visibility: w.VisibilityMode(),
		LockedBody: w.LockedBody(), Publish: w.IsPublished(),
	}
	// Timestamps don't go into frontmatter: created_at / published_at are
	// owned by the DB, and the import side doesn't read them either.
	addCoverImageRef(&fm, w, filenames)
	return fm
}

func addCoverImageRef(fm *Frontmatter, w *corpus.Writing, filenames map[string]string) {
	assetID := w.CoverImageAssetID()
	if assetID == "" {
		return
	}
	name, ok := filenames[assetID]
	if !ok {
		return
	}
	// cover_image is written into frontmatter as a custom field (Obsidian
	// displays it as text; Obsidian 1.4+ won't render it as an image embed,
	// but the export/import round-trip stays lossless).
	addCoverImageField(fm, "attachments/"+name)
}

// addCoverImageField -- carries cover_image by adding a non-typed field to
// frontmatter. Our Frontmatter struct has no static cover_image field, so
// it needs to land somewhere outside LockedBody. One ad-hoc option would be
// a post-processing step: insert a line after RenderFrontmatter's output.
// The simplest form is to add a CoverImage field directly to the
// frontmatter struct -- that's the route taken here (a one-time edit to
// frontmatter.go, same as any other custom field).
//
// Note: this function only updates fm.CoverImage (the field added in
// frontmatter.go).
func addCoverImageField(fm *Frontmatter, path string) {
	fm.CoverImage = path
}
