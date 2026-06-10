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

	"github.com/atmaxmoj/standmeet/internal/domain"
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
// 以及发码挂的 role id（usecase 默认走 owner 的 vanilla）。
type CommitInput struct {
	CodeExpiresAt      *pgtype.Timestamptz
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	OwnerID            string
	DraftID            string
	CodePlaintext      string
	CodeLabel          string
	CodePurpose        string
	AssumedRoleID      string
}

// CommitOutput —— Commit 返回值。把 (Application, AccessCode) 打包成单结构体
// 让方法签名 ≤2 returns（lint）。
type CommitOutput struct {
	Application domain.Application
	AccessCode  domain.AccessCode
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
	code, err := insertAccessCode(ctx, q, in, key.owner)
	if err != nil {
		return CommitOutput{}, err
	}
	app, err := insertApplication(ctx, q, key, draft, &code)
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

func loadDraftForCommit(
	ctx context.Context, q *dbq.Queries, key *draftKey,
) (dbq.ResumeDraft, error) {
	row, err := q.GetResumeDraft(ctx, dbq.GetResumeDraftParams{
		ID: key.draft, OwnerID: key.owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return dbq.ResumeDraft{}, domain.ErrResumeDraftNotFound
		}
		return dbq.ResumeDraft{}, fmt.Errorf("load draft: %w", err)
	}
	return row, nil
}

func insertAccessCode(
	ctx context.Context, q *dbq.Queries, in *CommitInput, ownerUUID pgtype.UUID,
) (domain.AccessCode, error) {
	emptyJSON, jerr := json.Marshal([]any{})
	if jerr != nil {
		return domain.AccessCode{}, fmt.Errorf("marshal empty jsonb: %w", jerr)
	}
	roleUUID, rerr := parseUUID(in.AssumedRoleID)
	if rerr != nil {
		return domain.AccessCode{}, fmt.Errorf("parse assumed_role_id: %w", rerr)
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
	})
	if err != nil {
		return domain.AccessCode{}, fmt.Errorf("create access code: %w", err)
	}
	return toDomainCode(&row), nil
}

func insertApplication(
	ctx context.Context, q *dbq.Queries, key *draftKey,
	draft *dbq.ResumeDraft, code *domain.AccessCode,
) (domain.Application, error) {
	codeUUID, err := parseUUID(code.ID)
	if err != nil {
		return domain.Application{}, fmt.Errorf("parse code id: %w", err)
	}
	row, err := q.CreateApplication(ctx, dbq.CreateApplicationParams{
		OwnerID:       key.owner,
		AccessCodeID:  codeUUID,
		JobSnapshot:   draft.JobSnapshot,
		ResumeContent: draft.ResumeContent,
	})
	if err != nil {
		return domain.Application{}, fmt.Errorf("create application: %w", err)
	}
	return toDomainApplication(&row)
}

// GetByID —— 按 (id, owner_id) 反查。
func (r *ApplicationRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (domain.Application, error) {
	owner, err := parseUUID(ownerID)
	if err != nil {
		return domain.Application{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	appUUID, err := parseUUID(id)
	if err != nil {
		return domain.Application{}, fmt.Errorf("parse application id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.GetApplication(ctx, dbq.GetApplicationParams{
		ID: appUUID, OwnerID: owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Application{}, domain.ErrApplicationNotFound
		}
		return domain.Application{}, fmt.Errorf("get application: %w", err)
	}
	return toDomainApplication(&row)
}

// ListByOwner —— admin "我投过哪些" 视图用；按 created_at desc。
func (r *ApplicationRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]domain.Application, error) {
	owner, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListApplicationsByOwner(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("list applications: %w", err)
	}
	out := make([]domain.Application, 0, len(rows))
	for i := range rows {
		app, terr := toDomainApplication(&rows[i])
		if terr != nil {
			return nil, terr
		}
		out = append(out, app)
	}
	return out, nil
}

func toDomainApplication(row *dbq.Application) (domain.Application, error) {
	var snapshot domain.FetchedJob
	if err := json.Unmarshal(row.JobSnapshot, &snapshot); err != nil {
		return domain.Application{}, fmt.Errorf("unmarshal job snapshot: %w", err)
	}
	var content domain.ResumeContent
	if err := json.Unmarshal(row.ResumeContent, &content); err != nil {
		return domain.Application{}, fmt.Errorf("unmarshal resume content: %w", err)
	}
	out := domain.Application{
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
