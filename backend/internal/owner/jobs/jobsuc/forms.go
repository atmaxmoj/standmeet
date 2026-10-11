// forms.go —— application forms (job-loop roadmap 5.4): a posting's questions, each with the
// latest answer the owner gave the same question; and the answers a form was filled with.

package jobsuc

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// FormOf —— the posting's form questions, with previous answers. A posting whose source is gone,
// or whose board has no form, has none.
func FormOf(
	ctx context.Context, deps *JobsDeps, ownerID string, job *jobsmodel.FetchedJob,
) ([]jobsmodel.FormQuestion, error) {
	qs, err := questionsOf(ctx, deps, ownerID, job)
	if err != nil {
		return nil, err
	}
	prev, err := deps.Apps.LatestAnswers(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	return withPrevious(qs, prev), nil
}

func withPrevious(
	qs []jobsmodel.FormQuestion, prev map[string]jobsmodel.PreviousAnswer,
) []jobsmodel.FormQuestion {
	for i := range qs {
		if p, ok := prev[jobsmodel.QuestionKey(qs[i].Label)]; ok {
			qs[i].PreviousAnswer = &p
		}
	}
	return qs
}

func questionsOf(
	ctx context.Context, deps *JobsDeps, ownerID string, job *jobsmodel.FetchedJob,
) ([]jobsmodel.FormQuestion, error) {
	src, err := deps.Sources.GetByID(ctx, ownerID, job.SourceID)
	if errors.Is(err, jobsmodel.ErrJobSourceNotFound) {
		return []jobsmodel.FormQuestion{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("form source: %w", err)
	}
	qs, err := deps.Registry.Questions(ctx, src.Kind, src.Config, job.ExternalID)
	if err != nil {
		return nil, fmt.Errorf("form questions: %w", err)
	}
	return qs, nil
}

// SaveAnswers —— applications.save_answers (5.4.b).
func SaveAnswers(
	ctx context.Context, deps *JobsDeps, ownerID, appID string, answers []jobsmodel.FormAnswer,
) error {
	kept := answers[:0:0]
	for _, a := range answers {
		if strings.TrimSpace(a.Question) != "" {
			kept = append(kept, a)
		}
	}
	if len(kept) == 0 {
		return jobsmodel.ErrNoAnswers
	}
	return deps.Apps.SaveAnswers(ctx, ownerID, appID, kept)
}

// SaveAnswers —— the answers, on the owner's application, in one transaction.
func (r *ApplicationRepo) SaveAnswers(
	ctx context.Context, ownerID, appID string, answers []jobsmodel.FormAnswer,
) error {
	owner, app := pgstore.UUIDOrNull(ownerID), pgstore.UUIDOrNull(appID)
	return pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		q := db.New(tx)
		owned, err := q.ApplicationOwned(ctx, db.ApplicationOwnedParams{ID: app, OwnerID: owner})
		if err != nil || !owned {
			return notFoundApplicationOr(err)
		}
		return insertAnswers(ctx, q, &db.InsertApplicationAnswerParams{
			OwnerID: owner, ApplicationID: app,
		}, answers)
	})
}

func insertAnswers(
	ctx context.Context, q *db.Queries, base *db.InsertApplicationAnswerParams,
	answers []jobsmodel.FormAnswer,
) error {
	for _, a := range answers {
		p := *base
		p.QuestionKey = jobsmodel.QuestionKey(a.Question)
		p.Question, p.Answer = a.Question, a.Answer
		if err := q.InsertApplicationAnswer(ctx, p); err != nil {
			return fmt.Errorf("save answer: %w", err)
		}
	}
	return nil
}

// LatestAnswers —— the owner's latest answer per question key.
func (r *ApplicationRepo) LatestAnswers(
	ctx context.Context, ownerID string,
) (map[string]jobsmodel.PreviousAnswer, error) {
	rows, err := db.New(r.pool).LatestApplicationAnswers(ctx, pgstore.UUIDOrNull(ownerID))
	if err != nil {
		return nil, fmt.Errorf("latest answers: %w", err)
	}
	out := make(map[string]jobsmodel.PreviousAnswer, len(rows))
	for _, row := range rows {
		out[row.QuestionKey] = jobsmodel.PreviousAnswer{
			Answer: row.Answer, ApplicationID: pgstore.FormatUUID(row.ApplicationID),
		}
	}
	return out, nil
}

func notFoundApplicationOr(err error) error {
	if err != nil {
		return fmt.Errorf("application owned: %w", err)
	}
	return jobsmodel.ErrApplicationNotFound
}
