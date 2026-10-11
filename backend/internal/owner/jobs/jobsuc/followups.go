// followups.go —— follow-ups and the funnel (job-loop roadmap 3.1, 3.2). The daily task announces
// each due application once and moves its marker on, per row in one transaction (the gas-refill
// pattern): a rerun, or a second runner, finds nothing left to announce.

package jobsuc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// FollowupTaskName —— the periodic task's name (tasks.run_periodic takes it).
const FollowupTaskName = "application followups"

// FollowupTask —— announce every due follow-up, once.
func FollowupTask(apps *ApplicationRepo, rec func() events.Recorder) func(context.Context) error {
	return func(ctx context.Context) error {
		due, err := apps.DueFollowups(ctx, "")
		if err != nil {
			return err
		}
		for i := range due {
			if aerr := apps.announceFollowup(ctx, rec(), &due[i]); aerr != nil {
				return aerr
			}
		}
		return nil
	}
}

// followupData —— application.followup_due's data.
type followupData struct {
	ApplicationID string `json:"application_id"`
	CodeID        string `json:"code_id"`
	Nudge         int32  `json:"nudge"`
}

// DueFollowups —— applications due a follow-up now; ownerID "" = every owner.
func (r *ApplicationRepo) DueFollowups(
	ctx context.Context, ownerID string,
) ([]jobsmodel.Application, error) {
	var owner pgtype.UUID
	if ownerID != "" {
		owner = pgstore.UUIDOrNull(ownerID)
	}
	rows, err := db.New(r.pool).DueFollowups(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("due follow-ups: %w", err)
	}
	out := make([]jobsmodel.Application, 0, len(rows))
	for i := range rows {
		app, terr := withReach(&rows[i].Application, rows[i].OpenedAt, rows[i].Questions)
		if terr != nil {
			return nil, terr
		}
		out = append(out, app)
	}
	return out, nil
}

// announceFollowup —— one nudge: the marker moves on and application.followup_due is recorded, in
// one transaction. A row someone else already took is skipped.
func (r *ApplicationRepo) announceFollowup(
	ctx context.Context, rec events.Recorder, a *jobsmodel.Application,
) error {
	return pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		row, err := db.New(tx).AdvanceFollowup(ctx, db.AdvanceFollowupParams{
			ID:             pgstore.UUIDOrNull(a.ID),
			NextFollowupAt: optTime(jobsmodel.FollowupAfterNudge(a.Outcome, time.Now())),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("advance follow-up: %w", err)
		}
		data := followupData{
			ApplicationID: a.ID, CodeID: pgstore.FormatUUID(row.AccessCodeID),
			Nudge: row.FollowupNudges,
		}
		return rec.With(tx).Record(ctx, pgstore.FormatUUID(row.OwnerID),
			ApplicationFollowupDue, "application/"+a.ID, data)
	})
}

func optTime(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// FunnelOf —— applications.funnel for the owner.
func FunnelOf(
	ctx context.Context, apps *ApplicationRepo, ownerID string,
) (jobsmodel.Funnel, error) {
	rows, err := db.New(apps.pool).FunnelRows(ctx, pgstore.UUIDOrNull(ownerID))
	if err != nil {
		return jobsmodel.Funnel{}, fmt.Errorf("funnel: %w", err)
	}
	in := make([]jobsmodel.FunnelInput, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		in = append(in, jobsmodel.FunnelInput{
			CreatedAt: r.CreatedAt.Time, OpenedAt: pgstore.OptTime(r.OpenedAt),
			FirstOutcomeAt: pgstore.OptTime(r.FirstOutcomeAt), Outcome: r.Outcome,
			Reached: r.Reached,
		})
	}
	return jobsmodel.FunnelOf(in), nil
}
