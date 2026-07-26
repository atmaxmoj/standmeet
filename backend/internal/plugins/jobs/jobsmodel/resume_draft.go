// resume_draft.go —— ResumeDraft aggregate: Phase 2 中间态。Claude 给出
// resume_content 后 owner 还在 preview 看；commit 之后变成 application（Phase 3）。
//
// L.13 决策：draft 创建时已经把 job snapshot 复制进来，commit 不依赖
// Redis TTL 还在 —— 池子里 evict 完照样可以 commit。
//
// PDF 永远 ephemeral —— 每次 MCP 调用现场用 gopdf 渲染 bytes 塞响应，
// server 端不存任何文件，draft 表里也没有 PDF 路径列。

package jobsmodel

import (
	"errors"
	"time"
)

// ResumeDraft —— DB-backed draft row（jsonb job_snapshot + resume_content
// 已解到对应 domain 类型）。
type ResumeDraft struct {
	CreatedAt     time.Time
	ExpiresAt     time.Time
	ResumeContent ResumeContent
	ID            string
	OwnerID       string
	JobCacheID    string
	JobSnapshot   FetchedJob
}

// CreateResumeDraftInput —— usecase 层 draft.create 入参（job snapshot
// 已经从 Redis 池子取出来由 caller 注入）。
type CreateResumeDraftInput struct {
	ResumeContent ResumeContent
	OwnerID       string
	JobCacheID    string
	JobSnapshot   FetchedJob
}

// ResumeDraft-scoped sentinels.
var (
	// ErrResumeDraftNotFound —— 按 (id, owner_id) 反查未命中，或已过期被
	// expires_at filter 过滤掉。
	ErrResumeDraftNotFound = errors.New("resume draft not found")
	// ErrResumeContentInvalid —— content 校验失败（必填字段缺）。
	ErrResumeContentInvalid = errors.New("resume content invalid")
)
