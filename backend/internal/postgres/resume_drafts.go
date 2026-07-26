// resume_drafts.go —— resume_drafts CRUD。Phase 2 中间态：Claude 通过 MCP
// resume.draft 写一行（job snapshot 已经从 Redis 池子复制进 jsonb），owner
// 看 preview（PDF bytes 现场渲染回 MCP 响应，不落盘）决定 commit / update / discard。
//
// 设计点：
// - job_snapshot 和 resume_content 都是 typed domain struct，repo 层负责
//   JSON marshal/unmarshal —— 上层 usecase / mcp / routes 都不感知 jsonb。
// - PDF 不持久化任何地方：caller 在每次 MCP 调用里现场用 gopdf 渲染 bytes
//   返回；repo 永远不碰 filesystem。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// draftKey —— (owner_uuid, draft_uuid) 成对解出。让多个 query 方法共享一次
// parse；返 (draftKey, error) 满足 lint 的 ≤2 returns 限制。
type draftKey struct {
	owner pgtype.UUID
	draft pgtype.UUID
}

// ResumeDraftRepo —— resume_drafts 单表 Repository。
type ResumeDraftRepo struct {
	pool *Pool
}

// NewResumeDraftRepo 构造 ResumeDraftRepo。
func NewResumeDraftRepo(pool *Pool) *ResumeDraftRepo {
	return &ResumeDraftRepo{pool: pool}
}

// Create —— Claude 调 resume.draft 时落库。in.JobSnapshot / in.ResumeContent
// 都已经在 usecase 层组装好；这里只负责 marshal + INSERT。
func (r *ResumeDraftRepo) Create(
	ctx context.Context, in *jobsmodel.CreateResumeDraftInput,
) (jobsmodel.ResumeDraft, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	snapshotJSON, err := json.Marshal(in.JobSnapshot)
	if err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("marshal job snapshot: %w", err)
	}
	contentJSON, err := json.Marshal(in.ResumeContent)
	if err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("marshal resume content: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateResumeDraft(ctx, dbq.CreateResumeDraftParams{
		OwnerID:       ownerUUID,
		JobCacheID:    in.JobCacheID,
		JobSnapshot:   snapshotJSON,
		ResumeContent: contentJSON,
	})
	if err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("create resume draft: %w", err)
	}
	return toDomainResumeDraft(&row)
}

// GetByID —— (id, owner_id) 反查；过期或 owner 不匹配返 ErrResumeDraftNotFound。
// query 自带 expires_at > now() 过滤，不需要 caller 二次判断。
func (r *ResumeDraftRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (jobsmodel.ResumeDraft, error) {
	key, err := parseDraftKey(ownerID, id)
	if err != nil {
		return jobsmodel.ResumeDraft{}, err
	}
	q := dbq.New(r.pool)
	row, err := q.GetResumeDraft(ctx, dbq.GetResumeDraftParams{
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

// UpdateContent —— resume.update_draft：替换 resume_content jsonb。job_snapshot
// 不变（snapshot 跟 cache 解耦，draft 创建后永远是创建时那一刻的快照）。
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
	q := dbq.New(r.pool)
	row, err := q.UpdateResumeDraftContent(ctx, dbq.UpdateResumeDraftContentParams{
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

// Delete —— resume.discard_draft；owner 不匹配静默成功（idempotent）。
func (r *ResumeDraftRepo) Delete(ctx context.Context, ownerID, id string) error {
	key, err := parseDraftKey(ownerID, id)
	if err != nil {
		return err
	}
	q := dbq.New(r.pool)
	if derr := q.DeleteResumeDraft(ctx, dbq.DeleteResumeDraftParams{
		ID: key.draft, OwnerID: key.owner,
	}); derr != nil {
		return fmt.Errorf("delete resume draft: %w", derr)
	}
	return nil
}

// ListByOwner —— admin /drafts 视图：列 owner 未过期的 draft，按
// created_at desc。1-day TTL 行不在列表里（filter 在 SQL 端做）。
func (r *ResumeDraftRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]jobsmodel.ResumeDraft, error) {
	owner, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
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

// SweepExpired —— 后台 sweeper / cron 调；删 expires_at <= now() 的行。
// 没有文件需要 unlink（PDF 从来不落盘）。
func (r *ResumeDraftRepo) SweepExpired(ctx context.Context) error {
	q := dbq.New(r.pool)
	if serr := q.SweepExpiredResumeDrafts(ctx); serr != nil {
		return fmt.Errorf("sweep expired resume drafts: %w", serr)
	}
	return nil
}

func parseDraftKey(ownerIDStr, idStr string) (draftKey, error) {
	owner, err := parseUUID(ownerIDStr)
	if err != nil {
		return draftKey{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	draft, err := parseUUID(idStr)
	if err != nil {
		return draftKey{}, fmt.Errorf("parse draft id: %w", err)
	}
	return draftKey{owner: owner, draft: draft}, nil
}

// toDomainResumeDraft —— sqlc Row → jobsmodel.ResumeDraft（含 jsonb unmarshal）。
func toDomainResumeDraft(row *dbq.ResumeDraft) (jobsmodel.ResumeDraft, error) {
	var snapshot jobsmodel.FetchedJob
	if err := json.Unmarshal(row.JobSnapshot, &snapshot); err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("unmarshal job snapshot: %w", err)
	}
	var content jobsmodel.ResumeContent
	if err := json.Unmarshal(row.ResumeContent, &content); err != nil {
		return jobsmodel.ResumeDraft{}, fmt.Errorf("unmarshal resume content: %w", err)
	}
	return jobsmodel.ResumeDraft{
		ID:            formatUUID(row.ID),
		OwnerID:       formatUUID(row.OwnerID),
		JobCacheID:    row.JobCacheID,
		JobSnapshot:   snapshot,
		ResumeContent: content,
		CreatedAt:     row.CreatedAt.Time,
		ExpiresAt:     row.ExpiresAt.Time,
	}, nil
}
