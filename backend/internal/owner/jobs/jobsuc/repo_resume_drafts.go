// resume_drafts.go — CRUD for resume_drafts. A Phase 2 intermediate state: Claude
// writes one row through MCP resume.draft (the job snapshot has already been copied
// from the Redis pool into jsonb), and the owner looks at the preview (PDF bytes
// rendered on the spot into the MCP response, never written to disk) and decides
// commit / update / discard.
//
// Design points:
// - job_snapshot and resume_content are both typed domain structs; the repo layer
//   handles JSON marshal/unmarshal — the usecase / mcp / routes layers above stay
//   unaware of jsonb.
// - The PDF is never persisted anywhere: the caller renders bytes on the spot with
//   gopdf on every MCP call and returns them; the repo never touches the filesystem.

package jobsuc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// draftKey — parses out (owner_uuid, draft_uuid) as a pair, so multiple query methods
// can share a single parse; returning (draftKey, error) satisfies lint's <=2 returns limit.
type draftKey struct {
	owner pgtype.UUID
	draft pgtype.UUID
}

// ResumeDraftRepo — the Repository for the single resume_drafts table.
type ResumeDraftRepo struct {
	pool *pgstore.Pool
}

// NewResumeDraftRepo constructs a ResumeDraftRepo.
func NewResumeDraftRepo(pool *pgstore.Pool) *ResumeDraftRepo {
	return &ResumeDraftRepo{pool: pool}
}

// Create — persists a row when Claude calls resume.draft. in.JobSnapshot /
// in.ResumeContent have already been assembled at the usecase layer; this only
// handles marshal + INSERT.
func (r *ResumeDraftRepo) Create(
	ctx context.Context, in *jobsmodel.CreateResumeDraftInput,
) (jobsmodel.ResumeDraft, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	snapshotJSON, err := json.Marshal(in.JobSnapshot)
	if err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("marshal job snapshot: %w", err)
	}
	contentJSON, err := json.Marshal(in.ResumeContent)
	if err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("marshal resume content: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.CreateResumeDraft(ctx, db.CreateResumeDraftParams{
		OwnerID:       ownerUUID,
		JobCacheID:    in.JobCacheID,
		JobSnapshot:   snapshotJSON,
		ResumeContent: contentJSON,
		Template:      in.Template,
	})
	if err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("create resume draft: %w", err)
	}
	return toDomainResumeDraft(&row)
}

// GetByID — looks up by (id, owner_id); expired or an owner mismatch returns
// ErrResumeDraftNotFound. The query filters expires_at > now() itself, so the
// caller doesn't need to check again.
func (r *ResumeDraftRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (jobsmodel.ResumeDraft, error) {
	key, err := parseDraftKey(ownerID, id)
	if err != nil {
		return jobsmodel.ResumeDraft{}, err
	}
	q := db.New(r.pool)
	row, err := q.GetResumeDraft(ctx, db.GetResumeDraftParams{
		ID: key.draft, OwnerID: key.owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jobsmodel.ResumeDraft{}, jobsmodel.ErrResumeDraftNotFound
		}
		return jobsmodel.ResumeDraft{}, fmt.Errorf("get resume draft: %w", err)
	}
	return toDomainResumeDraft(&row)
}

// UpdateContent — resume.update_draft: replaces the resume_content jsonb. job_snapshot
// stays unchanged (the snapshot is decoupled from the cache; once a draft is created
// it stays a snapshot of that exact moment forever).
func (r *ResumeDraftRepo) UpdateContent(
	ctx context.Context, ownerID, id string, content *jobsmodel.ResumeContent,
) (jobsmodel.ResumeDraft, error) {
	key, err := parseDraftKey(ownerID, id)
	if err != nil {
		return jobsmodel.ResumeDraft{}, err
	}
	contentJSON, err := json.Marshal(content)
	if err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("marshal resume content: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.UpdateResumeDraftContent(ctx, db.UpdateResumeDraftContentParams{
		ID: key.draft, OwnerID: key.owner, ResumeContent: contentJSON,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jobsmodel.ResumeDraft{}, jobsmodel.ErrResumeDraftNotFound
		}
		return jobsmodel.ResumeDraft{}, fmt.Errorf("update resume draft: %w", err)
	}
	return toDomainResumeDraft(&row)
}

// Delete — resume.discard_draft; an owner mismatch silently succeeds (idempotent).
func (r *ResumeDraftRepo) Delete(ctx context.Context, ownerID, id string) error {
	key, err := parseDraftKey(ownerID, id)
	if err != nil {
		return err
	}
	q := db.New(r.pool)
	if derr := q.DeleteResumeDraft(ctx, db.DeleteResumeDraftParams{
		ID: key.draft, OwnerID: key.owner,
	}); derr != nil {
		return fmt.Errorf("delete resume draft: %w", derr)
	}
	return nil
}

// ListByOwner — the admin /drafts view: lists the owner's unexpired drafts, ordered
// by created_at desc. Rows past the 1-day TTL are excluded (filtered on the SQL side).
func (r *ResumeDraftRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]jobsmodel.ResumeDraft, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, err := q.ListResumeDraftsByOwner(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("list resume drafts: %w", err)
	}
	out := make([]jobsmodel.ResumeDraft, 0, len(rows))
	for i := range rows {
		d, terr := toDomainResumeDraft(&rows[i])
		if terr != nil {
			return nil, terr
		}
		out = append(out, d)
	}
	return out, nil
}

// SweepExpired — called by the background sweeper / cron; deletes rows where
// expires_at <= now(). No file to unlink (the PDF is never written to disk).
func (r *ResumeDraftRepo) SweepExpired(ctx context.Context) error {
	q := db.New(r.pool)
	if serr := q.SweepExpiredResumeDrafts(ctx); serr != nil {
		return fmt.Errorf("sweep expired resume drafts: %w", serr)
	}
	return nil
}

func parseDraftKey(ownerIDStr, idStr string) (draftKey, error) {
	owner, err := pgstore.ParseUUID(ownerIDStr)
	if err != nil {
		return draftKey{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	draft, err := pgstore.ParseUUID(idStr)
	if err != nil {
		return draftKey{}, fmt.Errorf("parse draft id: %w", err)
	}
	return draftKey{owner: owner, draft: draft}, nil
}

// toDomainResumeDraft — sqlc Row -> jobsmodel.ResumeDraft (includes jsonb unmarshal).
func toDomainResumeDraft(row *db.ResumeDraft) (jobsmodel.ResumeDraft, error) {
	var snapshot jobsmodel.FetchedJob
	if err := json.Unmarshal(row.JobSnapshot, &snapshot); err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("unmarshal job snapshot: %w", err)
	}
	var content jobsmodel.ResumeContent
	if err := json.Unmarshal(row.ResumeContent, &content); err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("unmarshal resume content: %w", err)
	}
	return jobsmodel.ResumeDraft{
		ID:            pgstore.FormatUUID(row.ID),
		OwnerID:       pgstore.FormatUUID(row.OwnerID),
		JobCacheID:    row.JobCacheID,
		Template:      row.Template,
		JobSnapshot:   snapshot,
		ResumeContent: content,
		CreatedAt:     row.CreatedAt.Time,
		ExpiresAt:     row.ExpiresAt.Time,
	}, nil
}
