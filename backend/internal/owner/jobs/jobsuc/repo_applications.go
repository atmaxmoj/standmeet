// applications.go — applications + the related transaction (issue access_code + delete draft).
//
// Commit is the core of Phase 3: in a single transaction it
//   (1) reads the draft (must exist + not expired),
//   (2) inserts an access_code (used for the recruiter QR),
//   (3) inserts the application,
//   (4) deletes the draft.
// Rolls back entirely on any failure; an interruption at any step can never leave an
// orphan state like "the code was issued but the application never made it to the DB".

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

// ApplicationRepo — applications CRUD + the Commit transaction.
type ApplicationRepo struct {
	pool *pgstore.Pool
}

// NewApplicationRepo constructs an ApplicationRepo.
func NewApplicationRepo(pool *pgstore.Pool) *ApplicationRepo {
	return &ApplicationRepo{pool: pool}
}

// CommitInput — the inputs for one complete commit: owner + draft + the fields for
// access_code. The caller has already decided the code plaintext + label + expiry +
// quota (usecase-layer defaults), plus the role id the code is issued under (usecase
// default is the owner's public role).
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
	// CodePromptID — id of the builtin `hiring` prompt: the centrally-managed layer of
	// hiring context. Empty means this instance hasn't seeded `hiring` yet (shouldn't
	// happen, but must not block the application).
	CodePromptID  *string
	CodePurpose   string
	AssumedRoleID string
}

// CommitOutput — the return value of Commit. Packs (Application, AccessCode) into a
// single struct so the method signature stays at <=2 returns (lint).
type CommitOutput struct {
	Application jobsmodel.Application
	AccessCode  access.Code
}

// Commit — the whole transaction. Returns the domain shape of the new application +
// new access_code (AccessCode.Code is plaintext, which the caller uses to build the QR URL).
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

// insertAccessCode — issues the code inside the commit transaction. The job-loop never
// touches the access_codes DAO directly; it goes through access's tx-aware issuing entry
// point, writing on the same pgx.Tx (application row write + code issuance are atomic).
// Translates straight to the domain type, no longer holds onto pgtype.
func insertAccessCode(
	ctx context.Context, tx pgx.Tx, in *CommitInput, briefing string,
) (access.Code, error) {
	code, err := access.CreateAccessCodeTx(ctx, tx, &access.CreateAccessCodeInput{
		OwnerID:       in.OwnerID,
		Code:          in.CodePlaintext,
		Label:         in.CodeLabel,
		Purpose:       in.CodePurpose,
		AssumedRoleID: in.AssumedRoleID,
		// Two layers: the centrally-managed hiring context (prompt_id -> builtin `hiring`)
		// plus this one sentence specific to this code. They stack, so an auto-issued code
		// never has to choose between "hiring context" and "which role".
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

// recruiterBriefing — builds **the sentence specific to this code** from the draft's
// job_snapshot: which role I'm being evaluated for. It stacks on top of the `hiring`
// prompt (the code's prompt_id) — the generic hiring context belongs there, this only
// says "which role".
//
// Warning: this used to return an empty string when `snap.Title == ""`, and back then
// nobody had filled in the prompt_id slot either, and the two slots were mutually
// exclusive — so a job-board row with no title produced a **mute code**: the recruiter
// scanned it and landed on the default persona, and the agent answered from the product-
// positioning notes with "this isn't a persona suited for job hunting".
// Now both are covered together: prompt_id always carries hiring, and this function
// still states the source even when it can't identify the role.
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
		// The board gave no role name. The context still holds — what's missing is only
		// "which role", not "whether this is hiring".
		return arrivedVia
	}
	return "You are speaking with a recruiter who received your job application for " + role +
		". They reached you through that application — answer as the candidate, about that role."
}

// describeRole — describes the role. When title is empty but company is present, it can
// still state the source ("a role at MockCo"); an empty string means neither is present.
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

// roleAtCompany — can still state the source with just a company name; truly blank
// only when neither is present.
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
