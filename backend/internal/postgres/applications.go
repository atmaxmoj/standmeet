// applications.go —— applications + 关联事务（issue access_code + 删 draft）。
//
// Commit 是 Phase 3 的核心：单事务里
//   (1) 读 draft（must exist + not expired），
//   (2) 插 access_code（recruiter QR 用），
//   (3) 插 application，
//   (4) 删 draft。
// 全失败 rollback；任一环节中断都不会产生 "code 已 issue 但 application 没落库"
// 之类的孤儿状态。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// ApplicationRepo —— applications CRUD + Commit 事务。
type ApplicationRepo struct {
	pool *Pool
}

// NewApplicationRepo 构造 ApplicationRepo。
func NewApplicationRepo(pool *Pool) *ApplicationRepo {
	return &ApplicationRepo{pool: pool}
}

// CommitInput —— 一次完整 commit 的入参：owner + draft + 给 access_code 的字段。
// caller 已经决定了 code plaintext + label + 有效期 + 配额（usecase 层默认值），
// 以及发码挂的 role id（usecase 默认走 owner 的 public）。
type CommitInput struct {
	CodeExpiresAt      *pgtype.Timestamptz
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	OwnerID            string
	DraftID            string
	// ApplicationID —— caller-supplied so the PDF renders before commit (retryable on render fail).
	ApplicationID string
	CodePlaintext string
	CodeLabel     string
	CodePurpose   string
	AssumedRoleID string
}

// CommitOutput —— Commit 返回值。把 (Application, AccessCode) 打包成单结构体
// 让方法签名 ≤2 returns（lint）。
type CommitOutput struct {
	Application jobsmodel.Application
	AccessCode  access.Code
}

// Commit —— 全套事务。返回新 application + 新 access_code 的 domain 形状
// （AccessCode.Code 是 plaintext，调用方用来拼 QR URL）。
func (r *ApplicationRepo) Commit(
	ctx context.Context, in *CommitInput,
) (CommitOutput, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return CommitOutput{}, fmt.Errorf("begin tx: %w", err)
	}
	out, txErr := commitTx(ctx, tx, in)
	if txErr != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			return CommitOutput{}, errors.Join(txErr, fmt.Errorf("rollback: %w", rerr))
		}
		return CommitOutput{}, txErr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return CommitOutput{}, fmt.Errorf("commit: %w", cerr)
	}
	return out, nil
}

func commitTx(ctx context.Context, tx pgx.Tx, in *CommitInput) (CommitOutput, error) {
	key, err := parseDraftKey(in.OwnerID, in.DraftID)
	if err != nil {
		return CommitOutput{}, err
	}
	q := dbq.New(tx)
	draft, err := loadDraftForCommit(ctx, q, &key)
	if err != nil {
		return CommitOutput{}, err
	}
	return writeCommitRows(ctx, q, in, &key, &draft)
}

func writeCommitRows(
	ctx context.Context, q *dbq.Queries, in *CommitInput, key *draftKey, draft *dbq.ResumeDraft,
) (CommitOutput, error) {
	code, err := insertAccessCode(ctx, q, in, key.owner, recruiterBriefing(draft.JobSnapshot))
	if err != nil {
		return CommitOutput{}, err
	}
	app, err := insertApplication(ctx, q, &appInsert{
		key: key, draft: draft, code: &code, appID: in.ApplicationID,
	})
	if err != nil {
		return CommitOutput{}, err
	}
	if derr := q.DeleteResumeDraft(ctx, dbq.DeleteResumeDraftParams{
		ID: key.draft, OwnerID: key.owner,
	}); derr != nil {
		return CommitOutput{}, fmt.Errorf("delete draft: %w", derr)
	}
	return CommitOutput{Application: app, AccessCode: code}, nil
}

// DraftRenderData —— the resume + job snapshot needed to render the application PDF BEFORE the
// irreversible commit tx (so a render failure persists nothing → retryable).
type DraftRenderData struct {
	Resume jobsmodel.ResumeContent
	Job    jobsmodel.FetchedJob
}

// GetDraftRenderData —— read-only fetch of a draft's render inputs (no tx, nothing deleted).
// Missing draft → ErrResumeDraftNotFound.
func (r *ApplicationRepo) GetDraftRenderData(
	ctx context.Context, ownerID, draftID string,
) (DraftRenderData, error) {
	key, err := parseDraftKey(ownerID, draftID)
	if err != nil {
		return DraftRenderData{}, err
	}
	row, err := loadDraftForCommit(ctx, dbq.New(r.pool), &key)
	if err != nil {
		return DraftRenderData{}, err
	}
	var out DraftRenderData
	if uerr := json.Unmarshal(row.ResumeContent, &out.Resume); uerr != nil {
		return DraftRenderData{}, fmt.Errorf("unmarshal resume content: %w", uerr)
	}
	if uerr := json.Unmarshal(row.JobSnapshot, &out.Job); uerr != nil {
		return DraftRenderData{}, fmt.Errorf("unmarshal job snapshot: %w", uerr)
	}
	return out, nil
}

func loadDraftForCommit(
	ctx context.Context, q *dbq.Queries, key *draftKey,
) (dbq.ResumeDraft, error) {
	row, err := q.GetResumeDraft(ctx, dbq.GetResumeDraftParams{
		ID: key.draft, OwnerID: key.owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return dbq.ResumeDraft{}, jobsmodel.ErrResumeDraftNotFound
		}
		return dbq.ResumeDraft{}, fmt.Errorf("load draft: %w", err)
	}
	return row, nil
}

func insertAccessCode(
	ctx context.Context, q *dbq.Queries, in *CommitInput, ownerUUID pgtype.UUID, briefing string,
) (access.Code, error) {
	emptyJSON, jerr := json.Marshal([]any{})
	if jerr != nil {
		return access.Code{}, fmt.Errorf("marshal empty jsonb: %w", jerr)
	}
	roleUUID, rerr := parseUUID(in.AssumedRoleID)
	if rerr != nil {
		return access.Code{}, fmt.Errorf("parse assumed_role_id: %w", rerr)
	}
	expires := pgtype.Timestamptz{}
	if in.CodeExpiresAt != nil {
		expires = *in.CodeExpiresAt
	}
	row, err := q.CreateAccessCode(ctx, dbq.CreateAccessCodeParams{
		OwnerID:            ownerUUID,
		Code:               in.CodePlaintext,
		Label:              in.CodeLabel,
		Purpose:            in.CodePurpose,
		Ghosts:             emptyJSON,
		ExpiresAt:          expires,
		MaxMembers:         in.MaxMembers,
		MaxTurnsPerSession: in.MaxTurnsPerSession,
		AssumedRoleID:      roleUUID,
		InlinePrompt:       briefing,
	})
	if err != nil {
		return access.Code{}, fmt.Errorf("create access code: %w", err)
	}
	return toDomainCode(&row), nil
}

// recruiterBriefing —— 从 draft 的 job_snapshot 拼一段 persona 上下文，冻进 app-码的 inline_prompt
// （#104 扩展）：让 recruiter session 里的 AI 知道「对方在为哪个岗评估我」。core 无脑注入这段、不知道
// 它是应聘身份；job-loop 在这里（发码时）供给。解析失败 / 无 title → 空串（不阻断 commit）。
func recruiterBriefing(jobSnapshotJSON []byte) string {
	var snap struct {
		Title   string `json:"title"`
		Company string `json:"company"`
	}
	if err := json.Unmarshal(jobSnapshotJSON, &snap); err != nil || snap.Title == "" {
		return ""
	}
	role := snap.Title
	if snap.Company != "" {
		role += " at " + snap.Company
	}
	return "You are speaking with a recruiter who received your job application for " + role +
		". They reached you through that application — answer as the candidate, about that role."
}

// appInsert —— insertApplication args packed (keeps it within the argument limit).
type appInsert struct {
	key   *draftKey
	draft *dbq.ResumeDraft
	code  *access.Code
	appID string
}

func insertApplication(
	ctx context.Context, q *dbq.Queries, a *appInsert,
) (jobsmodel.Application, error) {
	codeUUID, err := parseUUID(a.code.ID)
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf("parse code id: %w", err)
	}
	appUUID, err := parseUUID(a.appID)
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf("parse application id: %w", err)
	}
	row, err := q.CreateApplication(ctx, dbq.CreateApplicationParams{
		ID:            appUUID,
		OwnerID:       a.key.owner,
		AccessCodeID:  codeUUID,
		JobSnapshot:   a.draft.JobSnapshot,
		ResumeContent: a.draft.ResumeContent,
	})
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf("create application: %w", err)
	}
	return toDomainApplication(&row)
}

// GetByID —— 按 (id, owner_id) 反查。
func (r *ApplicationRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (jobsmodel.Application, error) {
	owner, err := parseUUID(ownerID)
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	appUUID, err := parseUUID(id)
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf("parse application id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.GetApplication(ctx, dbq.GetApplicationParams{
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

// ListByOwner —— admin "我投过哪些" 视图用；按 created_at desc。
func (r *ApplicationRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]jobsmodel.Application, error) {
	owner, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
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

func toDomainApplication(row *dbq.Application) (jobsmodel.Application, error) {
	var snapshot jobsmodel.FetchedJob
	if err := json.Unmarshal(row.JobSnapshot, &snapshot); err != nil {
		return jobsmodel.Application{}, fmt.Errorf("unmarshal job snapshot: %w", err)
	}
	var content jobsmodel.ResumeContent
	if err := json.Unmarshal(row.ResumeContent, &content); err != nil {
		return jobsmodel.Application{}, fmt.Errorf("unmarshal resume content: %w", err)
	}
	out := jobsmodel.Application{
		ID:            formatUUID(row.ID),
		OwnerID:       formatUUID(row.OwnerID),
		AccessCodeID:  formatUUID(row.AccessCodeID),
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
