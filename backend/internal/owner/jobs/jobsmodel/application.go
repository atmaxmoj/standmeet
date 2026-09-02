// application.go —— Application aggregate (Phase 3 持久化记录)。
//
// 一条 application 必有一个同步 issue 的 AccessCode（recruiter 扫 QR 接回
// visitor chat）。job_snapshot 和 resume_content 是 commit 那一刻的快照，
// 即便对应 draft 删了 / Redis 池子 evict 了，application 不丢任何信息。
//
// status 取值（v1）：'pending'（owner 已 commit 但没投出去）→
// 'submitted'（Playwright 已成功提交）→ 'failed' / 'withdrawn'。
// Phase 3 只用 'pending'；Phase 4 Playwright 投递成功回填 submitted_at + status。

package jobsmodel

import (
	"errors"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// Application —— DB-backed application row。
type Application struct {
	CreatedAt    time.Time
	SubmittedAt  *time.Time
	ID           string
	OwnerID      string
	AccessCodeID string
	Status       string
	// Template —— 这份简历用哪个 Typst 排版（'' = 默认 classic）。定制化的选择项。
	Template      string
	ResumeContent ResumeContent
	JobSnapshot   FetchedJob
}

// CreateApplicationInput —— usecase 层 application.commit 入参。
// access_code 已经在同 tx 里先 issue 好；caller 把 ID 传进来。
type CreateApplicationInput struct {
	OwnerID       string
	AccessCodeID  string
	ResumeContent ResumeContent
	JobSnapshot   FetchedJob
}

// CommittedApplication —— applications.commit 返回值：application + 同步 issue
// 的 AccessCode（plaintext code 给 QR URL）+ 最终 PDF bytes。
type CommittedApplication struct {
	Application Application
	AccessCode  access.Code
	QRURL       string
	// Warning —— 投出去了，但有件事 owner 该知道（空 = 没有）。
	// 今天只有一件：hiring role 圈着 CV 而那条笔记不存在 —— 招聘官问雇主和日期时
	// 会被告知"不在笔记里"。**不阻断投递**，只是让这件事不再静默。
	Warning string
	PDF     []byte
}

// ErrApplicationNotFound —— 按 (id, owner_id) 反查未命中。
var ErrApplicationNotFound = errors.New("application not found")
