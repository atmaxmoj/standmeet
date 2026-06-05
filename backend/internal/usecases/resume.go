// resume.go —— Phase 2 resume draft usecase。Claude 通过 MCP `resume.draft`
// 把 (job_cache_id + resume_content) 交进来：
//   1. 从 Redis 池子取出 FetchedJob 当 snapshot（draft 创建即固化，不依赖 cache）
//   2. 落 resume_drafts 表（1d TTL，跟 Redis 同周期）
//
// PDF 这一步不渲染 —— owner 走 admin 浏览器看 React `ResumePage` live preview，
// 想下载就在浏览器里点 print / save。`applications.commit` 才走 gotenberg 渲染
// 终稿 PDF（带真 AccessCode QR）。
//
// 这样 draft / preview 不依赖 sidecar，编辑体验是即时的；server 端只持有结构
// 化 state。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	jobcache "github.com/atmaxmoj/standmeet/internal/plugins/jobs/cache"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// ResumeDeps —— resume.* usecase 依赖。
type ResumeDeps struct {
	Drafts *postgres.ResumeDraftRepo
	Cache  *jobcache.Pool
}

// DraftedResume —— resume.draft / update_draft 的返回。结构化 view only；PDF
// 由 admin 浏览器现场渲染（React `ResumePage`），不经 server。
type DraftedResume struct {
	Draft domain.ResumeDraft
}

// DraftResume —— Claude 调 resume.draft：拿 Redis 池子里的 job snapshot，
// 落 draft 表。
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
	return DraftedResume{Draft: draft}, nil
}

// UpdateResumeDraft —— Claude 调 resume.update_draft 调整 content。
// job_snapshot 不变（draft 创建时即固化）。
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
	return DraftedResume{Draft: draft}, nil
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
