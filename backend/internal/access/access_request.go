// access_request.go —— /<handle>/gate 上无 code 的访客留言。
// owner 在 /admin/requests 看；open → replied (回邮件后) / closed (无视)。
// 不自动通知 owner、不自动回邮件——owner-curated，是 product 设计的明确选择。

package access

import (
	"errors"
	"time"
)

// AccessRequest —— 一条访客留言。字段顺序按 govet fieldalignment：
// time.Time 在前（内部 ptr at offset 16），strings 紧跟。
type AccessRequest struct { //nolint:revive // AccessRequest domain term
	CreatedAt time.Time
	ID        string
	OwnerID   string
	Name      string
	Org       string
	Email     string
	Message   string
	Status    string // 'open' | 'replied' | 'closed'
}

// CreateAccessRequestInput —— usecase 创建一条留言的入参。
type CreateAccessRequestInput struct {
	OwnerID string
	Name    string
	Org     string
	Email   string
	Message string
}

// ErrAccessRequestNotFound —— UpdateStatus 时 id 不存在或不属于此 owner。
var ErrAccessRequestNotFound = errors.New("access request not found")

// ErrAccessRequestStatusInvalid —— UpdateStatus 传入的 status 不合法。
var ErrAccessRequestStatusInvalid = errors.New("access request status invalid")
