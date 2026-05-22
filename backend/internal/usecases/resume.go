// resume.go —— Phase 2 resume draft usecase。Claude 通过 MCP `resume.draft`
// 把 (job_cache_id + resume_content) 交进来：
//   1. 从 Redis 池子取出 FetchedJob 当 snapshot（draft 创建即固化，不依赖 cache）
//   2. 落 resume_drafts 表（1d TTL，跟 Redis 同周期）
//   3. **现场**渲染 preview PDF bytes 塞响应（preview QR 用 placeholder URL，
//      正式 QR 在 Phase 3 commit 时才有 AccessCode 可用）
//
// PDF 不落盘 —— bytes 走 MCP 响应回 Claude，Claude 给 owner 看，丢就丢。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/jobcache"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/resumerender"
)

// previewQRPlaceholder —— preview 用的固定 URL，提示 owner "这是预览不是终稿"。
// commit 阶段会换成 `<base_url>/<handle>?code=<access_code>`。
const previewQRPlaceholder = "preview://standmeet/draft"

// ResumeDeps —— resume.* usecase 依赖。
type ResumeDeps struct {
	Drafts *postgres.ResumeDraftRepo
	Cache  *jobcache.Pool
}

// DraftedResume —— resume.draft / update_draft 的返回。PDF 是当下渲染的 bytes，
// 不落盘；调用方决定怎么序列化（base64 / MCP resource link 等）。
type DraftedResume struct {
	Draft domain.ResumeDraft
	PDF   []byte
}

// DraftResume —— Claude 调 resume.draft：拿 Redis 池子里的 job snapshot，
// 落 draft 表，渲染 preview PDF bytes 一并返。
func DraftResume(
	ctx context.Context, deps ResumeDeps, ownerID, jobCacheID string, content *domain.ResumeContent,
) (DraftedResume, error) {
	if err := requireFields(ownerID, jobCacheID, content); err != nil {
		return DraftedResume{}, err
	}
	snapshot, err := loadJobSnapshot(ctx, deps, ownerID, jobCacheID)
	if err != nil {
		return DraftedResume{}, err
	}
	draft, err := deps.Drafts.Create(ctx, &domain.CreateResumeDraftInput{
		OwnerID:       ownerID,
		JobCacheID:    jobCacheID,
		JobSnapshot:   snapshot,
		ResumeContent: *content,
	})
	if err != nil {
		return DraftedResume{}, fmt.Errorf("create draft: %w", err)
	}
	return renderDrafted(&draft)
}

// UpdateResumeDraft —— Claude 调 resume.update_draft 调整 content；
// 重新渲染 preview PDF bytes 返。job_snapshot 不变（draft 创建时即固化）。
func UpdateResumeDraft(
	ctx context.Context, deps ResumeDeps, ownerID, draftID string, content *domain.ResumeContent,
) (DraftedResume, error) {
	if err := requireFields(ownerID, draftID, content); err != nil {
		return DraftedResume{}, err
	}
	draft, err := deps.Drafts.UpdateContent(ctx, ownerID, draftID, content)
	if err != nil {
		return DraftedResume{}, fmt.Errorf("update draft: %w", err)
	}
	return renderDrafted(&draft)
}

func requireFields(s1, s2 string, content *domain.ResumeContent) error {
	if s1 == "" || s2 == "" || content == nil {
		return ErrEmptyField
	}
	return nil
}

func loadJobSnapshot(
	ctx context.Context, deps ResumeDeps, ownerID, jobCacheID string,
) (domain.FetchedJob, error) {
	snapshot, err := deps.Cache.Get(ctx, ownerID, jobCacheID)
	if err != nil {
		if errors.Is(err, jobcache.ErrCacheMiss) {
			return domain.FetchedJob{}, domain.ErrJobCacheMiss
		}
		return domain.FetchedJob{}, fmt.Errorf("cache get: %w", err)
	}
	return snapshot, nil
}

func renderDrafted(draft *domain.ResumeDraft) (DraftedResume, error) {
	pdf, err := resumerender.Render(&draft.ResumeContent, previewQRPlaceholder)
	if err != nil {
		return DraftedResume{}, fmt.Errorf("render preview pdf: %w", err)
	}
	return DraftedResume{Draft: *draft, PDF: pdf}, nil
}

// DiscardResumeDraft —— resume.discard_draft；idempotent（owner 不匹配/已删都静默成功）。
func DiscardResumeDraft(ctx context.Context, deps ResumeDeps, ownerID, draftID string) error {
	if ownerID == "" || draftID == "" {
		return ErrEmptyField
	}
	if err := deps.Drafts.Delete(ctx, ownerID, draftID); err != nil {
		return fmt.Errorf("delete draft: %w", err)
	}
	return nil
}
