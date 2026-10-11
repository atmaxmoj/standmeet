// engagement.go —— applications.engagement and applications.gaps (job-loop roadmap 2.1, 2.5): the
// recruiter's questions on the owner's application codes, read from the conversations on them.

package jobsuc

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// EngagementOf —— one application's exchanges. A missing application is ErrApplicationNotFound.
func EngagementOf(
	ctx context.Context, apps *ApplicationRepo, ownerID, appID string,
) (jobsmodel.Engagement, error) {
	if _, err := apps.GetByID(ctx, ownerID, appID); err != nil {
		return jobsmodel.Engagement{}, err
	}
	ex, err := apps.Exchanges(ctx, ownerID, pgstore.UUIDOrNull(appID))
	if err != nil {
		return jobsmodel.Engagement{}, err
	}
	return jobsmodel.EngagementOf(ex), nil
}

// ApplicationDetail —— one application, its outcome timeline and the recruiter's questions: what
// the panel's detail shows and what the vault export writes.
type ApplicationDetail struct {
	Outcomes  []jobsmodel.OutcomeRow
	Questions []jobsmodel.Exchange
	Row       jobsmodel.ApplicationRow
}

// DetailOf —— the detail of an application already read.
func DetailOf(
	ctx context.Context, apps *ApplicationRepo, ownerID string, app *jobsmodel.Application,
) (ApplicationDetail, error) {
	entries, err := apps.Outcomes(ctx, app.ID)
	if err != nil {
		return ApplicationDetail{}, err
	}
	ex, err := apps.Exchanges(ctx, ownerID, pgstore.UUIDOrNull(app.ID))
	if err != nil {
		return ApplicationDetail{}, err
	}
	return ApplicationDetail{
		Row: jobsmodel.RowOf(app), Outcomes: jobsmodel.OutcomeRowsOf(entries),
		Questions: jobsmodel.EngagementOf(ex).Questions,
	}, nil
}

// ExportApplication —— the application as a vault markdown file (roadmap 7.5.a).
func ExportApplication(
	ctx context.Context, apps *ApplicationRepo, ownerID, appID string,
) (jobsmodel.ExportFile, error) {
	app, err := apps.GetByID(ctx, ownerID, appID)
	if err != nil {
		return jobsmodel.ExportFile{}, err
	}
	d, err := DetailOf(ctx, apps, ownerID, &app)
	if err != nil {
		return jobsmodel.ExportFile{}, err
	}
	return jobsmodel.ApplicationMarkdown(&d.Row, d.Outcomes, d.Questions), nil
}

// GapsAcross —— every ungrounded question on any of the owner's applications.
func GapsAcross(
	ctx context.Context, apps *ApplicationRepo, ownerID string,
) ([]jobsmodel.Gap, error) {
	ex, err := apps.Exchanges(ctx, ownerID, pgtype.UUID{})
	if err != nil {
		return nil, err
	}
	return jobsmodel.GapsOf(ex), nil
}

// Exchanges —— questions and answers on the owner's application codes; app narrows (invalid = all).
func (r *ApplicationRepo) Exchanges(
	ctx context.Context, ownerID string, app pgtype.UUID,
) ([]jobsmodel.Exchange, error) {
	rows, err := db.New(r.pool).ApplicationExchanges(ctx, db.ApplicationExchangesParams{
		OwnerID: pgstore.UUIDOrNull(ownerID), ApplicationID: app,
	})
	if err != nil {
		return nil, fmt.Errorf("application exchanges: %w", err)
	}
	out := make([]jobsmodel.Exchange, 0, len(rows))
	for _, row := range rows {
		out = append(out, jobsmodel.Exchange{
			ApplicationID: pgstore.FormatUUID(row.ApplicationID), AskedAt: row.AskedAt.Time,
			ConversationID: pgstore.FormatUUID(row.ConversationID), Question: row.Question,
			Answer: row.Answer, Grounded: row.Grounded,
			Topics: jobsmodel.TopicsOf(row.Question),
		})
	}
	return out, nil
}
