// note_asset_refs.go —— recompute-on-save for a corpus note's asset references
// (docs/design/global-assets.md).
//
// A note references exactly the pool assets its content cites: the standmeet-asset:<id> tokens in
// its body plus its cover. That set is recomputed from the content on every save — never
// hand-maintained per action — and asset_references is set to exactly it. This is the single rule
// that makes reuse work (a second note citing the same pool asset adds a second reference) and
// keeps references honest (editing an image out of the body frees its reference at the next save).
// The delete guard then counts live use exactly.
//
// Like RebuildNoteRefs (crosslinks), asset_references is a derived index and need not share the
// write transaction — so this runs after the note row is written, using the pool (non-tx) methods.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// RebuildNoteAssetRefs —— recompute one corpus note's asset references from its current content.
// Reads the note (body + cover) and sets asset_references('corpus', noteID) to exactly the
// owner-owned assets it cites. No-op on a wiring without media plugged in (read-only paths).
func RebuildNoteAssetRefs(ctx context.Context, deps Deps, ownerID, noteID string) error {
	if !deps.HasMedia() {
		return nil
	}
	hero, err := deps.Media.Hero.Get(ctx, ownerID, noteID)
	if err != nil {
		return fmt.Errorf("read note for asset refs: %w", err)
	}
	return rebuildAssetRefs(ctx, deps.Media.Assets.Repo, ownerID, noteID, &hero)
}

// rebuildAssetRefs —— the shared core. A caller that already holds the note's hero (a cover change,
// or a just-saved writing) calls this directly, avoiding a re-read.
//
// Content only drives references to **inline images + the cover** (all kind=image): the body cites
// them by standmeet-asset:<id>, the cover by id. Attachments (a PDF in the download area) are a
// different thing — they are attached to the entry and listed there, not cited in the body — so
// they are referenced by attach and freed by explicit detach, NOT by this recompute. That is why
// this is a **diff over image-kind references** and not a blanket delete-and-reinsert: nuking every
// reference would drop the entry's attachments on the next unrelated save.
func rebuildAssetRefs(
	ctx context.Context, assets *repo.AssetRepo, ownerID, noteID string, hero *entity.NoteHero,
) error {
	ids := ScanAssetReferences(hero.Body)
	if hero.CoverAssetID != "" {
		ids = append(ids, hero.CoverAssetID)
	}
	cited, err := assets.OwnedAssetIDs(ctx, ownerID, ids)
	if err != nil {
		return fmt.Errorf("filter cited assets: %w", err)
	}
	current, lerr := assets.ListByReferrer(ctx, repo.RefKindCorpus, noteID)
	if lerr != nil {
		return fmt.Errorf("list current asset refs: %w", lerr)
	}
	if derr := dropStaleImageRefs(ctx, assets, noteID, current, cited); derr != nil {
		return derr
	}
	// Insert the cited set — InsertReference is idempotent, so already-present ones are a no-op.
	return insertAssetRefs(ctx, assets, noteID, cited)
}

// dropStaleImageRefs —— remove references to image-kind assets this note no longer cites. Only
// image-kind refs are touched, so attachments (and any other kind) are left exactly as they were.
func dropStaleImageRefs(
	ctx context.Context, assets *repo.AssetRepo, noteID string,
	current []entity.Asset, cited []string,
) error {
	citedSet := toIDSet(cited)
	for i := range current {
		a := &current[i]
		if !staleImageRef(a, noteID, citedSet) {
			continue
		}
		if err := assets.DeleteReference(ctx, a.ID, repo.RefKindCorpus, noteID); err != nil {
			return fmt.Errorf("de-reference asset: %w", err)
		}
	}
	return nil
}

// staleImageRef —— a reference recompute should drop: a **reused** pool image this note no longer
// cites. Two things are deliberately never stale here:
//   - non-image kinds (attachments) — they're attached to the entry, not cited in the body;
//   - an asset whose holder is THIS note — it was uploaded here, so this entry is its home and it
//     stays attached whether or not the body/cover cites it (the panel lists the entry's own
//     uploads; the owner removes one explicitly via DeleteNoteAsset). Only an image reused FROM
//     the pool (holder ≠ this note) is content-driven: cited in → referenced, cited out → freed.
func staleImageRef(a *entity.Asset, noteID string, cited map[string]struct{}) bool {
	if a.Kind != entity.AssetKindImage || a.HolderID == noteID {
		return false
	}
	_, ok := cited[a.ID]
	return !ok
}

func toIDSet(ids []string) map[string]struct{} {
	set := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		set[id] = struct{}{}
	}
	return set
}

// RebuildWritingAssetRefs —— the writings variant. A writing runs its own in-tx save, so this is
// called after the tx commits (the pool then sees the just-inserted asset rows), using the saved
// writing's final body (pending ids already rewritten to real ones) + cover.
func RebuildWritingAssetRefs(
	ctx context.Context, assets *repo.AssetRepo, ownerID string, w *entity.Writing,
) error {
	hero := entity.NoteHero{Body: w.Body(), CoverAssetID: w.CoverImageAssetID()}
	return rebuildAssetRefs(ctx, assets, ownerID, w.ID(), &hero)
}

func insertAssetRefs(
	ctx context.Context, assets *repo.AssetRepo, noteID string, ids []string,
) error {
	for _, id := range ids {
		if err := assets.InsertReference(ctx, id, repo.RefKindCorpus, noteID); err != nil {
			return fmt.Errorf("reference asset: %w", err)
		}
	}
	return nil
}
