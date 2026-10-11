// repo_application_outcomes.go —— an application's outcome and its timeline, and the guard that
// makes application.engaged fire once (roadmap E1). Each write records its event on the same
// transaction.

package jobsuc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// OutcomeChange —— one change asked for: which application, to what, and the owner's note.
type OutcomeChange struct {
	OwnerID       string
	ApplicationID string
	To            string
	Note          string
}

// ChangedOutcome —— what a change did: the outcome before, and the application's code.
type ChangedOutcome struct {
	From   string
	CodeID string
}

// ChangeOutcome —— sets the outcome, appends the timeline row and records
// application.outcome_changed, in one transaction. Setting the outcome it already has writes
// nothing.
func (r *ApplicationRepo) ChangeOutcome(
	ctx context.Context, rec events.Recorder, c *OutcomeChange,
) (ChangedOutcome, error) {
	var out ChangedOutcome
	err := pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		q := db.New(tx)
		cur, lerr := q.LockApplicationOutcome(ctx, db.LockApplicationOutcomeParams{
			ID: pgstore.UUIDOrNull(c.ApplicationID), OwnerID: pgstore.UUIDOrNull(c.OwnerID),
		})
		if lerr != nil {
			return notFoundApplication(lerr)
		}
		out = ChangedOutcome{From: cur.Outcome, CodeID: pgstore.FormatUUID(cur.AccessCodeID)}
		if cur.Outcome == c.To {
			return nil
		}
		return writeOutcome(ctx, q, rec.With(tx), c, &out)
	})
	return out, err
}

func writeOutcome(
	ctx context.Context, q *db.Queries, rec events.Recorder, c *OutcomeChange, out *ChangedOutcome,
) error {
	app := pgstore.UUIDOrNull(c.ApplicationID)
	if err := q.SetApplicationOutcome(ctx, db.SetApplicationOutcomeParams{
		ID: app, OwnerID: pgstore.UUIDOrNull(c.OwnerID), Outcome: c.To,
		NextFollowupAt: optTime(jobsmodel.FollowupAfterOutcome(c.To, time.Now())),
	}); err != nil {
		return fmt.Errorf("set outcome: %w", err)
	}
	if err := q.InsertApplicationOutcome(ctx, db.InsertApplicationOutcomeParams{
		ApplicationID: app, FromOutcome: out.From, ToOutcome: c.To, Note: c.Note,
	}); err != nil {
		return fmt.Errorf("outcome timeline: %w", err)
	}
	data := map[string]string{
		"application_id": c.ApplicationID, "from": out.From, "to": c.To, "note": c.Note,
	}
	subject := "application/" + c.ApplicationID
	return rec.Record(ctx, c.OwnerID, ApplicationOutcomeChanged, subject, data)
}

// Outcomes —— an application's outcome timeline, oldest first.
func (r *ApplicationRepo) Outcomes(
	ctx context.Context, applicationID string,
) ([]jobsmodel.OutcomeEntry, error) {
	rows, err := db.New(r.pool).ListApplicationOutcomes(ctx, pgstore.UUIDOrNull(applicationID))
	if err != nil {
		return nil, fmt.Errorf("list outcomes: %w", err)
	}
	out := make([]jobsmodel.OutcomeEntry, 0, len(rows))
	for i := range rows {
		out = append(out, jobsmodel.OutcomeEntry{
			From: rows[i].FromOutcome, To: rows[i].ToOutcome, Note: rows[i].Note,
			CreatedAt: rows[i].CreatedAt.Time,
		})
	}
	return out, nil
}

// MarkEngaged —— the first conversation on an application's code: engaged_at is set and
// application.engaged recorded, in one transaction. A code with no application, or an application
// already engaged, changes nothing (the guarded update returns no row).
func (r *ApplicationRepo) MarkEngaged(
	ctx context.Context, rec events.Recorder, codeID, conversationID string,
) error {
	return pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		row, err := db.New(tx).MarkApplicationEngaged(ctx, pgstore.UUIDOrNull(codeID))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("mark engaged: %w", err)
		}
		appID := pgstore.FormatUUID(row.ID)
		data := map[string]string{
			"application_id": appID, "code_id": codeID, "conversation_id": conversationID,
		}
		return rec.With(tx).Record(ctx, pgstore.FormatUUID(row.OwnerID), ApplicationEngaged,
			"application/"+appID, data)
	})
}

func notFoundApplication(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return jobsmodel.ErrApplicationNotFound
	}
	return fmt.Errorf("lock application: %w", err)
}
