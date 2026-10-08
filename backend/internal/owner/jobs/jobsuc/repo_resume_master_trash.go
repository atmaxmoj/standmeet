// repo_resume_master_trash.go —— the résumé master trash
// (migrations/2026-10-08-resume-master-trash.sql): Delete sets deleted_at; these list, restore and
// purge.

package jobsuc

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// Trash —— the owner's trashed masters, newest delete first.
func (r *ResumeMasterRepo) Trash(
	ctx context.Context, ownerID string,
) ([]jobsmodel.TrashedMaster, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, err := db.New(r.pool).ListTrashedResumeMasters(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("list trashed resume masters: %w", err)
	}
	out := make([]jobsmodel.TrashedMaster, 0, len(rows))
	for i := range rows {
		at := rows[i].DeletedAt.Time
		out = append(out, jobsmodel.TrashedMaster{
			ID: pgstore.FormatUUID(rows[i].ID), Name: rows[i].Name,
			DeletedAt: at, PurgeAt: at.Add(jobsmodel.MasterTrashRetention),
		})
	}
	return out, nil
}

// Restore —— takes a master out of the trash. ErrResumeMasterNotInTrash when it is not there.
func (r *ResumeMasterRepo) Restore(ctx context.Context, ownerID, id string) error {
	key, ok := wellFormedKey(ownerID, id)
	if !ok {
		return jobsmodel.ErrResumeMasterNotInTrash
	}
	n, err := db.New(r.pool).RestoreResumeMaster(ctx, db.RestoreResumeMasterParams{
		ID: key.draft, OwnerID: key.owner,
	})
	if err != nil {
		return fmt.Errorf("restore resume master: %w", err)
	}
	if n == 0 {
		return jobsmodel.ErrResumeMasterNotInTrash
	}
	return nil
}

// Purge —— drops every master trashed before cutoff.
func (r *ResumeMasterRepo) Purge(ctx context.Context, cutoff time.Time) error {
	before := pgtype.Timestamptz{Time: cutoff, Valid: true}
	if _, err := db.New(r.pool).PurgeTrashedResumeMasters(ctx, before); err != nil {
		return fmt.Errorf("purge trashed resume masters: %w", err)
	}
	return nil
}
