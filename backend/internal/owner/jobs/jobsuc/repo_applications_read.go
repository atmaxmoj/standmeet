// applications_read.go —— applications 的读路径：按 id / 按 access code 反查、列表，及 row→domain。
// 从 repo_applications.go 拆出（那份留 Commit 事务本身），保持一份文件一件事。

package jobsuc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// GetByID —— 按 (id, owner_id) 反查。
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

// GetByAccessCode —— 按 session 的 access code 反查它绑的那一份 application。owner-scoped，
// 于是一个 owner 的会话永不会读到另一个 owner 的 application(纵深防御；access_code_id 已全局唯一)。
// 没绑 application 的普通码 → ErrApplicationNotFound(访客侧简历工具据此隐藏，不报错)。
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

// ListByOwner —— admin "我投过哪些" 视图用；按 created_at desc。
func (r *ApplicationRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]jobsmodel.Application, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, err := q.ListApplicationsByOwner(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("list applications: %w", err)
	}
	out := make([]jobsmodel.Application, 0, len(rows))
	for i := range rows {
		app, terr := toDomainApplication(&rows[i])
		if terr != nil {
			return nil, terr
		}
		out = append(out, app)
	}
	return out, nil
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
