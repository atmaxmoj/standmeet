// corpus_crud.go —— entry points for the corpus three-layer Update / Delete / Create
// wiki+output that admin UI calls. raw's Update takes "change body + tags + private";
// wiki / output's Update changes title/body/tags/parent/show_as_source. Create wiki /
// output lets the owner start a new
// entry directly from the admin UI (not promoted from raw); the source field stays empty.
// retrieval-redesign: the visibility field is dropped entirely; path / show_as_source now live
// in SEORepo.UpdateWikiSEO / UpdateOutputSEO and the ShowAsSource field here.

package usecase

import (
	"context"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// ─── raw ────────────────────────────────────────────────────

// UpdateRawReq —— input for admin's raw update.
type UpdateRawReq struct {
	OwnerID        string
	ID             string
	Body           string
	Tags           []string
	FlaggedPrivate bool
}

// UpdateRaw changes raw_entries' body + tags + flagged_private.
func UpdateRaw(
	ctx context.Context, deps Deps, in *UpdateRawReq,
) (entity.Raw, error) {
	if in.OwnerID == "" || in.ID == "" || in.Body == "" {
		return entity.Raw{}, apierr.ErrEmptyField
	}
	raw, err := deps.Raw.UpdateBody(ctx, &repo.UpdateRawInput{
		OwnerID: in.OwnerID, ID: in.ID,
		Body: in.Body, Tags: in.Tags, FlaggedPrivate: in.FlaggedPrivate,
	})
	if err != nil {
		return entity.Raw{}, fmt.Errorf("update raw: %w", err)
	}
	return raw, nil
}

// DeleteRaw deletes one raw entry. **A real delete, same as wiki / output.**
//
// This used to be ArchiveRaw: set an archived flag, keep the row. That "soft delete" never
// had a second half — no listing surfaces archived rows (ListRaw always filters
// archived=false), no way to restore, and the button on the panel labeled archive already
// fired DELETE. So it wasn't a gentler kind of delete, it was the same thing under a
// different name, plus a tombstone row nobody ever reads.
func DeleteRaw(ctx context.Context, deps Deps, ownerID, rawID string) error {
	if ownerID == "" || rawID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Raw.Delete(ctx, ownerID, rawID); err != nil {
		return fmt.Errorf("delete raw: %w", err)
	}
	deleteNoteHook(ctx, deps, rawID)
	return nil
}

// ─── wiki ───────────────────────────────────────────────────

// CreateWikiReq —— admin starts a wiki entry directly (not promoted). SourceRawIDs stays empty.
type CreateWikiReq struct {
	ParentID *string
	// ShowAsSource —— nil = citable (default). A new entry that the owner marks non-referable
	// (the meta/persona kind) must carry it through at CREATE too, not only on a later update.
	ShowAsSource *bool
	OwnerID      string
	Title        string
	Body         string
	Tags         []string
}

// CreateWiki starts a new wiki entry (the entry point behind admin UI's "+new wiki" button).
func CreateWiki(
	ctx context.Context, deps Deps, in *CreateWikiReq,
) (entity.Wiki, error) {
	if err := preflightCreateWiki(ctx, deps, in); err != nil {
		return entity.Wiki{}, err
	}
	wiki, err := deps.Wiki.Create(ctx, &repo.CreateWikiInput{
		OwnerID:      in.OwnerID,
		ParentID:     in.ParentID,
		Title:        in.Title,
		Body:         in.Body,
		Tags:         in.Tags,
		ShowAsSource: in.ShowAsSource,
	})
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("create wiki: %w", err)
	}
	if rerr := RebuildNoteRefs(ctx, deps, in.OwnerID, wiki.ID(), in.Body); rerr != nil {
		return entity.Wiki{}, rerr
	}
	return wiki, nil
}

// preflightCreateWiki —— two gates before create: required fields + parent validity. Combined
// here so CreateWiki's cyclomatic complexity stays under the limit.
func preflightCreateWiki(ctx context.Context, deps Deps, in *CreateWikiReq) error {
	if in.OwnerID == "" || in.Title == "" || in.Body == "" {
		return apierr.ErrEmptyField
	}
	return validateWikiParent(ctx, deps, in.OwnerID, in.ParentID)
}

// UpdateWikiReq —— input for admin's wiki update.
type UpdateWikiReq struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	CSSClasses   []string
	ShowAsSource bool
}

// UpdateWiki changes wiki's main fields.
func UpdateWiki(
	ctx context.Context, deps Deps, in *UpdateWikiReq,
) (entity.Wiki, error) {
	if err := preflightUpdateWiki(ctx, deps, in); err != nil {
		return entity.Wiki{}, err
	}
	wiki, err := deps.Wiki.Update(ctx, &repo.UpdateWikiInput{
		OwnerID: in.OwnerID, ID: in.ID, ParentID: in.ParentID,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		ShowAsSource: in.ShowAsSource, CSSClasses: in.CSSClasses,
	})
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("update wiki: %w", err)
	}
	if rerr := RebuildNoteRefs(ctx, deps, in.OwnerID, wiki.ID(), in.Body); rerr != nil {
		return entity.Wiki{}, rerr
	}
	indexNoteHook(ctx, deps, in.OwnerID, wiki.ID())
	return wiki, nil
}

// preflightUpdateWiki —— three gates before UpdateWiki: required fields + reparent validity
// (exists / same owner / no cycle) + no sibling slug collision (renaming or reparenting can
// both collide; excludes itself). Combined here so UpdateWiki's cyclomatic complexity stays
// under the limit.
func preflightUpdateWiki(ctx context.Context, deps Deps, in *UpdateWikiReq) error {
	if hasBlankCorpusField(in.OwnerID, in.ID, in.Title, in.Body) {
		return apierr.ErrEmptyField
	}
	if err := validateWikiReparent(ctx, deps, in.OwnerID, in.ID, in.ParentID); err != nil {
		return err
	}
	return ensureSiblingSlugFree(ctx, deps, siblingSlugCheck{
		OwnerID: in.OwnerID, ParentID: in.ParentID, Title: in.Title, ExcludeID: in.ID,
	})
}

// hasBlankCorpusField —— the shared "required field is blank" check for
// UpdateWiki / UpdateOutput.
func hasBlankCorpusField(vals ...string) bool {
	return slices.Contains(vals, "")
}

// DeleteWiki hard-deletes one wiki entry.
func DeleteWiki(ctx context.Context, deps Deps, ownerID, wikiID string) error {
	if ownerID == "" || wikiID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Wiki.Delete(ctx, ownerID, wikiID); err != nil {
		return fmt.Errorf("delete wiki: %w", err)
	}
	deleteNoteHook(ctx, deps, wikiID)
	return nil
}

// ─── output ─────────────────────────────────────────────────

// CreateOutputReq —— admin starts an output entry directly (not promoted).
// SourceWikiIDs stays empty.
type CreateOutputReq struct {
	ParentID *string
	// ShowAsSource —— nil = quotable (default). Threaded at CREATE too, so a new non-referable
	// output entry is honored, not silently made citable until the owner edits it.
	ShowAsSource *bool
	OwnerID      string
	Title        string
	Body         string
	Tags         []string
}

// CreateOutput starts a new output entry (the entry point behind admin UI's "+new output" button).
func CreateOutput(
	ctx context.Context, deps Deps, in *CreateOutputReq,
) (entity.Output, error) {
	if in.OwnerID == "" || in.Title == "" || in.Body == "" {
		return entity.Output{}, apierr.ErrEmptyField
	}
	out, err := deps.Output.Create(ctx, &repo.CreateOutputInput{
		OwnerID:      in.OwnerID,
		ParentID:     in.ParentID,
		Title:        in.Title,
		Body:         in.Body,
		Tags:         in.Tags,
		ShowAsSource: in.ShowAsSource,
	})
	if err != nil {
		return entity.Output{}, fmt.Errorf("create output: %w", err)
	}
	return out, nil
}

// UpdateOutputReq —— input for admin's output update.
type UpdateOutputReq struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	ShowAsSource bool
}

// UpdateOutput changes output's main fields.
func UpdateOutput(
	ctx context.Context, deps Deps, in *UpdateOutputReq,
) (entity.Output, error) {
	if hasBlankCorpusField(in.OwnerID, in.ID, in.Title, in.Body) {
		return entity.Output{}, apierr.ErrEmptyField
	}
	out, err := deps.Output.Update(ctx, &repo.UpdateOutputInput{
		OwnerID: in.OwnerID, ID: in.ID, ParentID: in.ParentID,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		ShowAsSource: in.ShowAsSource,
	})
	if err != nil {
		return entity.Output{}, fmt.Errorf("update output: %w", err)
	}
	if rerr := RebuildNoteRefs(ctx, deps, in.OwnerID, out.ID(), in.Body); rerr != nil {
		return entity.Output{}, fmt.Errorf("rebuild output refs: %w", rerr)
	}
	indexNoteHook(ctx, deps, in.OwnerID, out.ID())
	return out, nil
}

// DeleteOutput hard-deletes one output entry.
func DeleteOutput(ctx context.Context, deps Deps, ownerID, outputID string) error {
	if ownerID == "" || outputID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Output.Delete(ctx, ownerID, outputID); err != nil {
		return fmt.Errorf("delete output: %w", err)
	}
	deleteNoteHook(ctx, deps, outputID)
	return nil
}
