// applications_read.go — the read path for applications: lookup by id / by access code,
// listing, and row->domain conversion. Split out of repo_applications.go (which keeps
// only the Commit transaction itself), so each file does one thing.

package jobsuc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// GetByID — looks up by (id, owner_id).
func (r *ApplicationRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (jobsmodel.Application, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	appUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf("parse application id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.GetApplication(ctx, db.GetApplicationParams{
		ID: appUUID, OwnerID: owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jobsmodel.Application{}, jobsmodel.ErrApplicationNotFound
		}
		return jobsmodel.Application{}, fmt.Errorf("get application: %w", err)
	}
	return toDomainApplication(&row)
}

// GetByAccessCode — looks up the application bound to a session's access code.
// owner-scoped, so one owner's session can never read another owner's application
// (defense in depth; access_code_id is already globally unique).
// A plain code with no application bound -> ErrApplicationNotFound (the visitor-side
// resume tool hides itself on this, rather than erroring).
func (r *ApplicationRepo) GetByAccessCode(
	ctx context.Context, ownerID, codeID string,
) (jobsmodel.Application, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	code, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf("parse access code id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.GetApplicationByAccessCode(ctx, db.GetApplicationByAccessCodeParams{
		AccessCodeID: code, OwnerID: owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jobsmodel.Application{}, jobsmodel.ErrApplicationNotFound
		}
		return jobsmodel.Application{}, fmt.Errorf("get application by access code: %w", err)
	}
	return toDomainApplication(&row)
}

// ListPage — one page of the admin "what have I applied to" view, newest first; the page reports
// how many applications there are.
func (r *ApplicationRepo) ListPage(
	ctx context.Context, ownerID, search string, req paging.Request,
) (paging.Page[jobsmodel.Application], error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return paging.Page[jobsmodel.Application]{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	after, err := pgstore.CursorArgs(req.After)
	if err != nil {
		return paging.Page[jobsmodel.Application]{}, fmt.Errorf("list applications: %w", err)
	}
	q := db.New(r.pool)
	rows, err := q.ListApplicationsPage(ctx, db.ListApplicationsPageParams{
		OwnerID: owner, Q: search, AfterAt: after.At, AfterID: after.ID, Lim: req.Fetch(),
	})
	if err != nil {
		return paging.Page[jobsmodel.Application]{}, fmt.Errorf("list applications: %w", err)
	}
	total, err := q.CountApplications(ctx, owner)
	if err != nil {
		return paging.Page[jobsmodel.Application]{}, fmt.Errorf("count applications: %w", err)
	}
	page, err := applicationsPage(rows, req)
	return page.WithTotal(total), err
}

// applicationsPage —— the rows as domain applications, cut to the page.
func applicationsPage(
	rows []db.ListApplicationsPageRow, req paging.Request,
) (paging.Page[jobsmodel.Application], error) {
	out := make([]jobsmodel.Application, 0, len(rows))
	for i := range rows {
		app, terr := toDomainApplication(&rows[i].Application)
		if terr != nil {
			return paging.Page[jobsmodel.Application]{}, terr
		}
		out = append(out, app)
	}
	return paging.Cut(out, req, func(a *jobsmodel.Application) paging.Cursor {
		return paging.Cursor{At: a.CreatedAt, ID: a.ID}
	}), nil
}

func toDomainApplication(row *db.Application) (jobsmodel.Application, error) {
	var snapshot jobsmodel.FetchedJob
	if err := json.Unmarshal(row.JobSnapshot, &snapshot); err != nil {
		return jobsmodel.Application{}, fmt.Errorf("unmarshal job snapshot: %w", err)
	}
	var content jobsmodel.ResumeContent
	if err := json.Unmarshal(row.ResumeContent, &content); err != nil {
		return jobsmodel.Application{}, fmt.Errorf("unmarshal resume content: %w", err)
	}
	out := jobsmodel.Application{
		ID:            pgstore.FormatUUID(row.ID),
		OwnerID:       pgstore.FormatUUID(row.OwnerID),
		AccessCodeID:  pgstore.FormatUUID(row.AccessCodeID),
		Status:        row.Status,
		JobSnapshot:   snapshot,
		ResumeContent: content,
		CreatedAt:     row.CreatedAt.Time,
	}
	if row.SubmittedAt.Valid {
		t := row.SubmittedAt.Time
		out.SubmittedAt = &t
	}
	return out, nil
}
