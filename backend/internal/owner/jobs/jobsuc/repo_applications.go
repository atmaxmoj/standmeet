// applications.go —— applications + 关联事务（issue access_code + 删 draft）。
//
// Commit 是 Phase 3 的核心：单事务里
//   (1) 读 draft（must exist + not expired），
//   (2) 插 access_code（recruiter QR 用），
//   (3) 插 application，
//   (4) 删 draft。
// 全失败 rollback；任一环节中断都不会产生 "code 已 issue 但 application 没落库"
// 之类的孤儿状态。

package jobsuc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// ApplicationRepo —— applications CRUD + Commit 事务。
type ApplicationRepo struct {
	pool *pgstore.Pool
}

// NewApplicationRepo 构造 ApplicationRepo。
func NewApplicationRepo(pool *pgstore.Pool) *ApplicationRepo {
	return &ApplicationRepo{pool: pool}
}

// CommitInput —— 一次完整 commit 的入参：owner + draft + 给 access_code 的字段。
// caller 已经决定了 code plaintext + label + 有效期 + 配额（usecase 层默认值），
// 以及发码挂的 role id（usecase 默认走 owner 的 public）。
type CommitInput struct {
	CodeExpiresAt      *time.Time
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	OwnerID            string
	DraftID            string
	// ApplicationID —— caller-supplied so the PDF renders before commit (retryable on render fail).
	ApplicationID string
	CodePlaintext string
	CodeLabel     string
	// CodePromptID —— builtin `hiring` prompt 的 id。集中管理的那一层招聘语境;
	// 空 = 这台实例还没种出 hiring(不该发生,但不阻断投递)。
	CodePromptID  *string
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
	draft, err := loadDraftForCommit(ctx, db.New(tx), &key)
	if err != nil {
		return CommitOutput{}, err
	}
	return writeCommitRows(ctx, tx, in, &key, &draft)
}

func writeCommitRows(
	ctx context.Context, tx pgx.Tx, in *CommitInput, key *draftKey, draft *db.ResumeDraft,
) (CommitOutput, error) {
	q := db.New(tx)
	code, err := insertAccessCode(ctx, tx, in, recruiterBriefing(draft.JobSnapshot))
	if err != nil {
		return CommitOutput{}, err
	}
	app, err := insertApplication(ctx, q, &appInsert{
		key: key, draft: draft, code: &code, appID: in.ApplicationID,
	})
	if err != nil {
		return CommitOutput{}, err
	}
	if derr := q.DeleteResumeDraft(ctx, db.DeleteResumeDraftParams{
		ID: key.draft, OwnerID: key.owner,
	}); derr != nil {
		return CommitOutput{}, fmt.Errorf("delete draft: %w", derr)
	}
	return CommitOutput{Application: app, AccessCode: code}, nil
}

// DraftRenderData —— the resume + job snapshot needed to render the application PDF BEFORE the
// irreversible commit tx (so a render failure persists nothing → retryable).
type DraftRenderData struct {
	Template string
	Resume   jobsmodel.ResumeContent
	Job      jobsmodel.FetchedJob
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
	row, err := loadDraftForCommit(ctx, db.New(r.pool), &key)
	if err != nil {
		return DraftRenderData{}, err
	}
	var out DraftRenderData
	out.Template = row.Template
	if uerr := json.Unmarshal(row.ResumeContent, &out.Resume); uerr != nil {
		return DraftRenderData{}, fmt.Errorf("unmarshal resume content: %w", uerr)
	}
	if uerr := json.Unmarshal(row.JobSnapshot, &out.Job); uerr != nil {
		return DraftRenderData{}, fmt.Errorf("unmarshal job snapshot: %w", uerr)
	}
	return out, nil
}

func loadDraftForCommit(
	ctx context.Context, q *db.Queries, key *draftKey,
) (db.ResumeDraft, error) {
	row, err := q.GetResumeDraft(ctx, db.GetResumeDraftParams{
		ID: key.draft, OwnerID: key.owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.ResumeDraft{}, jobsmodel.ErrResumeDraftNotFound
		}
		return db.ResumeDraft{}, fmt.Errorf("load draft: %w", err)
	}
	return row, nil
}

// insertAccessCode —— 在 commit 事务内发码。job-loop 不直接碰 access_codes DAO;经 access 的
// tx-aware 发码口在同一 pgx.Tx 上写(写 application 行 + 发码原子)。域类型平移,不再持 pgtype。
func insertAccessCode(
	ctx context.Context, tx pgx.Tx, in *CommitInput, briefing string,
) (access.Code, error) {
	code, err := access.CreateAccessCodeTx(ctx, tx, &access.CreateAccessCodeInput{
		OwnerID:       in.OwnerID,
		Code:          in.CodePlaintext,
		Label:         in.CodeLabel,
		Purpose:       in.CodePurpose,
		AssumedRoleID: in.AssumedRoleID,
		// 两层：集中管理的招聘语境（prompt_id → builtin `hiring`）+ 这一张码专属的那一句。
		// 它们是叠加的,所以自动签的码不必在"招聘语境"和"哪个职位"之间二选一。
		PromptID:           in.CodePromptID,
		InlinePrompt:       briefing,
		ExpiresAt:          in.CodeExpiresAt,
		MaxMembers:         in.MaxMembers,
		MaxTurnsPerSession: in.MaxTurnsPerSession,
		Ghosts:             []string{},
	})
	if err != nil {
		return access.Code{}, fmt.Errorf("issue application access code: %w", err)
	}
	return code, nil
}

// recruiterBriefing —— 从 draft 的 job_snapshot 拼**这一张码专属**的那一句：对方在为哪个岗
// 评估我。它叠在 `hiring` prompt（码的 prompt_id）之后 —— 通用的招聘语境归那一份，
// 这里只说"是哪个职位"。
//
// ⚠️ 曾经在 `snap.Title == ""` 时返回空串，而那时 prompt_id 那一档没人填、两档又是互斥的
// —— 于是招聘板吐一行没有 title 的数据，签出去的就是一张**哑码**：招聘官扫进来落在默认
// 人格里，agent 照着产品定位笔记答"这不是一个适合找工作的人设"。
// 现在两件事一起兜住：prompt_id 永远挂着 hiring，而这里即使认不出职位也说清来路。
func recruiterBriefing(jobSnapshotJSON []byte) string {
	const arrivedVia = "They reached you through a job application you sent — " +
		"answer as the candidate."
	var snap struct {
		Title   string `json:"title"`
		Company string `json:"company"`
	}
	if err := json.Unmarshal(jobSnapshotJSON, &snap); err != nil {
		return arrivedVia
	}
	role := describeRole(snap.Title, snap.Company)
	if role == "" {
		// 板子没给职位名。语境照旧成立 —— 缺的只是"哪个岗",不是"是不是招聘"。
		return arrivedVia
	}
	return "You are speaking with a recruiter who received your job application for " + role +
		". They reached you through that application — answer as the candidate, about that role."
}

// describeRole —— 职位描述。title 空但 company 在时仍说得出来路（"a role at MockCo"）,
// 空串表示两样都没有。
func describeRole(title, company string) string {
	title = strings.TrimSpace(title)
	company = strings.TrimSpace(company)
	switch {
	case title == "":
		return roleAtCompany(company)
	case company == "":
		return title
	default:
		return title + " at " + company
	}
}

// roleAtCompany —— 只有公司名时还说得出来路；两样都没有才是真的说不出。
func roleAtCompany(company string) string {
	if company == "" {
		return ""
	}
	return "a role at " + company
}

// appInsert —— insertApplication args packed (keeps it within the argument limit).
type appInsert struct {
	key   *draftKey
	draft *db.ResumeDraft
	code  *access.Code
	appID string
}

func insertApplication(
	ctx context.Context, q *db.Queries, a *appInsert,
) (jobsmodel.Application, error) {
	codeUUID, err := pgstore.ParseUUID(a.code.ID)
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf("parse code id: %w", err)
	}
	appUUID, err := pgstore.ParseUUID(a.appID)
	if err != nil {
		return jobsmodel.Application{}, fmt.Errorf("parse application id: %w", err)
	}
	row, err := q.CreateApplication(ctx, db.CreateApplicationParams{
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
