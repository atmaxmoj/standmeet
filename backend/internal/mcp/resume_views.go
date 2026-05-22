// resume_views.go —— resume.* tool 响应中 text-content 部分的 JSON 形状。
// PDF 不在这里 —— PDF 走 EmbeddedResource (blob base64)，跟结构化数据并行回。

package mcp

import (
	"github.com/wangsijie/standmeet/internal/domain"
)

// resumeDraftViewT —— draft / update_draft 返回的 text 部分。owner 在 Claude
// 一侧看到这个 JSON + 一个嵌入 PDF；可以让 AI 用 draft.id 调 update / commit。
type resumeDraftViewT struct {
	ID          string         `json:"draft_id"`
	JobCacheID  string         `json:"job_cache_id"`
	ExpiresAt   string         `json:"expires_at"`
	CreatedAt   string         `json:"created_at"`
	JobSnapshot fetchedJobView `json:"job_snapshot"`
}

func resumeDraftView(d *domain.ResumeDraft) resumeDraftViewT {
	return resumeDraftViewT{
		ID:          d.ID,
		JobCacheID:  d.JobCacheID,
		JobSnapshot: fetchedJobToView(&d.JobSnapshot),
		ExpiresAt:   d.ExpiresAt.Format(mcpTimeFmt),
		CreatedAt:   d.CreatedAt.Format(mcpTimeFmt),
	}
}
