// corpus_trash.go —— list, restore and purge the corpus trash (repo/corpus_trash.go).

package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

// trashPurgeEvery —— the trash grows by the delete, and a day's slack on a 90-day window is noise.
const trashPurgeEvery = 24 * time.Hour

// ListTrash —— the owner's trashed roots, newest first.
func ListTrash(ctx context.Context, deps *Deps, ownerID string) ([]repo.TrashItem, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	return deps.NoteRefs.Trash().List(ctx, ownerID)
}

// RestoreFromTrash —— puts the entry and the descendants deleted with it back, then re-derives
// their asset references (the delete freed them; the link edges come back from the trash itself).
// Search re-indexes through the corpus_notes trigger, like any insert.
func RestoreFromTrash(ctx context.Context, deps *Deps, ownerID, noteID string) ([]string, error) {
	if ownerID == "" || noteID == "" {
		return nil, apierr.ErrEmptyField
	}
	ids, err := deps.NoteRefs.Trash().Restore(ctx, ownerID, noteID)
	if err != nil {
		return nil, err
	}
	return ids, rebuildAssetRefsOf(ctx, deps, ownerID, ids)
}

func rebuildAssetRefsOf(ctx context.Context, deps *Deps, ownerID string, ids []string) error {
	for _, id := range ids {
		if err := RebuildNoteAssetRefs(ctx, *deps, ownerID, id); err != nil {
			return fmt.Errorf("restore asset references: %w", err)
		}
	}
	return nil
}

// TrashPeriodicJobs —— the daily purge of trash older than entity.TrashRetention. A nil repo
// exposes none: a panel must not show a job that reports "ok" while doing nothing.
//
// also —— the other corpus trashes this one purge empties (posts keep their own deleted_at).
func TrashPeriodicJobs(
	trash *repo.TrashRepo, also ...func(ctx context.Context, before time.Time) error,
) []periodic.Job {
	if trash == nil {
		return []periodic.Job{}
	}
	notes := func(ctx context.Context, before time.Time) error {
		_, err := trash.Purge(ctx, before)
		return err
	}
	purges := append([]func(context.Context, time.Time) error{notes}, also...)
	return []periodic.Job{periodic.Named(
		"corpus trash purge", trashPurgeEvery,
		func(ctx context.Context) error {
			before := time.Now().UTC().Add(-entity.TrashRetention)
			for _, purge := range purges {
				if err := purge(ctx, before); err != nil {
					return err
				}
			}
			return nil
		},
	)}
}
