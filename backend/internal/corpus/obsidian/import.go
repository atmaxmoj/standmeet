// import.go — bulk ingest of a vault directory. The route layer accepts the multipart
// upload (owner picked the whole vault via webkitdirectory), splits it into .md files
// and attachments, and here each .md gets converted into a corpus.SaveWriting call.
//
// Flow:
//   1. Classify .md vs non-.md; index non-.md files into the attachment map by basename
//   2. For each .md:
//      a. Parse frontmatter; skip when publish != true
//      b. For each image ref in the body → look up its bytes in the attachment index →
//         mint a pending-<uuid> to use as SaveWriting's PendingID
//      c. Rewrite the image ref in the body to standmeet-asset:pending-<uuid>
//      d. Check whether the owner already has a writing with the same
//         obsidian_source_path / same slug: matched → update, unmatched → create
//         (the vault is the single live source — there's no web-wins; a web edit
//         the owner wants to keep must be exported back to the vault before the
//         next sync)
//      e. SetObsidianMeta(source_path) to stamp imported_at
//   3. Return ImportResult to the caller so the UI can show stats

package obsidian

import (
	"context"
	"errors"
	"fmt"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// VaultFile — one file from the multipart upload. RelPath is the path relative to
// the vault (webkitdirectory's webkitRelativePath); the route layer parses it out
// and passes it in here.
type VaultFile struct {
	RelPath string
	Body    []byte
}

// ImportResult — stats for one import batch.
// fieldalignment: slices (24B) first, ints after.
type ImportResult struct {
	Errors []string
	// Notices —— accepted, but has something to say. A note with a broken multi-lang
	// structure takes this path: sync is a MIRROR, so refusing it means the owner
	// loses content; but a note where readers can only see half the article has to
	// surface on the panel — otherwise it's the same silence as a sandbox that fails
	// to boot and never logs anything.
	Notices []string
	// Kept —— ids of the rows this batch actually MATCHED (only the writings path
	// populates it today).
	//
	// The prune criterion is "was vault-imported, but not in keep → the vault deleted
	// it". writings runs a completely different path from the corp tree, and it used
	// to match a row without reporting it into keep — so a writing just created by
	// the very same full import got deleted by its own prune tens of milliseconds
	// later; on the real corpus, the row count for `genre='writing'` sat at 0 long
	// term while the receipt kept printing `1 new · 1 deleted` every time (F-L-63).
	//
	// The rule, therefore: ANY path that claims a row MUST report it here.
	Kept    []string
	Created int
	Updated int
	Skipped int
	// Deleted —— notes removed because they are gone from the vault (authoritative sync, F-L-6).
	// Always 0 for a partial upload and for ImportVault (writings), which never delete.
	Deleted int
}

// ImportVault — main entry point for the route layer. The owner uploads the whole
// vault via multipart; this ingests every .md with publish: true.
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

// processArgs — bundles processOne's arguments (dodges the argument-limit-5 lint).
type processArgs struct {
	Deps        corpus.WritingsTxDeps
	Setter      MetaSetter
	MD          *VaultFile
	Attachments map[string]VaultFile
	Result      *ImportResult
	OwnerID     string
}

// MetaSetter — stamps a row as vault-sourced after SaveWriting.
// Implemented by corpus.WritingRepo.{GetByObsidianSourcePath, GetBySlug, SetObsidianMeta}.
type MetaSetter interface {
	GetByObsidianSourcePath(
		ctx context.Context, ownerID, sourcePath string,
	) (corpus.Writing, error)
	GetBySlug(ctx context.Context, ownerID, slug string) (corpus.Writing, error)
	SetObsidianMeta(ctx context.Context, ownerID, writingID, sourcePath string) error
}

// partitionedVault — bundles partitionFiles's multiple returns (dodges the
// funcresult-limit lint + a named return). fieldalignment: map (1 ptr 8B)
// first, slice (3 ptr 24B) after.
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
		// Indexed by basename: Obsidian resolves [[image.png]] by basename lookup,
		// regardless of which vault subdirectory it lives in.
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

// incrementOutcome — a map lookup lowers finalizeResult's cyclomatic complexity.
// A map instead of switch + default because default would return the same
// pointer as outcomeSkipped, which trips the identical-switch-branches lint;
// the map form has no switch.
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
	// Not in the enum (unreachable, but falls back to skipped as a safety net).
	result.Skipped++
}

type upsertOutcome int

const (
	outcomeCreated upsertOutcome = iota
	outcomeUpdated
	outcomeSkipped
)

// parsedVault / parseVaultMarkdown / rewriteBodyAttachments / resolveCoverRef
// are implemented in import_parse.go, shared across files but in the same package.

// upsertArgs — bundles upsertFromVault's arguments (dodges argument-limit-5 + hugeParam).
type upsertArgs struct {
	Deps   corpus.WritingsTxDeps
	Setter MetaSetter
	Parsed *parsedVault
	// Result —— stats for this batch. Which row a writing landed on is also recorded
	// here (`Kept`): MATCH it but fail to report, and prune treats it as "not in the
	// vault" and deletes it (F-L-63).
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
		return outcomeSkipped, nil // not a byte changed → this is unchanged, not updated (F-L-64)
	}
	return outcome, nil
}

// runSaveAndMark — saves this row and stamps it with the vault mark. Returns
// false when content is byte-for-byte unchanged, meaning nothing was written.
func runSaveAndMark(ctx context.Context, a *upsertArgs, existing *corpus.Writing) (bool, error) {
	in := buildSaveInputFromVault(a.OwnerID, existing, a.SourcePath, a.Parsed)
	if existing.ID() != "" && unchangedWriting(existing, &in) {
		// Skip the write when nothing changed (F-L-64). But it STILL must be
		// reported into Kept — this run genuinely matched it, and skipping the
		// report lets the prune right after treat it as gone from the vault
		// and delete it (F-L-63).
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
	// REPORT this row's id: this writing matched this run, so prune must spare it.
	// The line above just stamped it "vault-imported", and prune deletes exactly
	// the rows that are stamped but not in keep — skipping the report is self-deletion.
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

// findWriting — claim by source_path first; if unmatched, fall back to slug
// (move/rename changes source_path but slug stays stable).
func findWriting(ctx context.Context, a *upsertArgs) (corpus.Writing, bool) {
	if w, found := lookupExistingWriting(ctx, a.Setter, a.OwnerID, a.SourcePath); found {
		return w, true
	}
	return lookupWritingBySlug(ctx, a.Setter, a.OwnerID, pickSlug(a.Parsed.fm.Slug, a.SourcePath))
}

// lookupWritingBySlug — claims by slug when source_path didn't match
// (slug is the stable identity across move/rename).
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
