// access_code.go —— 访客访问码（aggregate root）+ 子实体 CodeMember。
// revoke 只在 code 级别（status='revoked'）做；单 member 不可单独 revoke ——
// 那种复杂度不值。

package domain

import (
	"errors"
	"time"
)

// AccessCode —— 访客访问码。
//
//   - MaxMembers nil → 不限；这张码最多容纳几个不同名字(member = 一个人 =
//     一段续聊的会)。满了之后新名字被拒(visitor 见 "code 已满");已有名字续。
//   - MaxTurnsPerSession   nil → 不限；单 session 内 visitor turn 上限。
//   - Status 'active' / 'revoked'（过期由 ExpiresAt 计算，不写状态字段）。
//   - AssumedRoleID 必填，指向 owner 的 roles 行 id；session issue 时 freeze
//     出 [[role_snapshot]]。owner 不显式选 → usecase 默认绑 public。
//   - MaxBookings nil → role 没解锁 calendar.book 时也无意义；非 nil 是
//     per-code 跨 visitor 累计配额，从 code_bookings count 计。
type AccessCode struct {
	CreatedAt          time.Time
	ExpiresAt          *time.Time
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	MaxBookings        *int32
	// RequireGhostEvidence —— F-A-10 per-code 覆盖(nil = 继承 role 的开关)。
	RequireGhostEvidence *bool
	PromptID             *string
	ID                   string
	OwnerID              string
	Code                 string
	Label                string
	Purpose              string
	Status               string
	AssumedRoleID        string
	// InlinePrompt —— #104 扩展：随码内联的 per-code prompt。非空时冻进 RoleSnapshot.code_prompt_body
	// （优先于 PromptID 库引用）。发码方（如 job-loop）随码带一段 persona 上下文用，不污染 prompt 库。
	InlinePrompt string
	Ghosts       []string
}

// CreateAccessCodeInput —— 创建 access code 入参 (domain-level，供 MCP cap +
// 任何下游写入 AccessCode 用)。postgres.CreateCodeInput 是 repo-local 镜像，
// CodeRepo.CreateAccessCode 把本类型转过去。
type CreateAccessCodeInput struct {
	ExpiresAt          *time.Time
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	MaxBookings        *int32
	PromptID           *string
	OwnerID            string
	Code               string
	Label              string
	Purpose            string
	AssumedRoleID      string
	InlinePrompt       string
	Ghosts             []string
}

// CodeMember —— 一个 access code 下的一个具名访客（AccessCode 聚合子实体）。
// 同一个 code 同一个 display_name 是唯一 row。revoke 只在 AccessCode 级别
// 做（code.status='revoked'），不针对单个 member——后者复杂度不值。
type CodeMember struct {
	LastSeenAt  time.Time
	ID          string
	CodeID      string
	DisplayName string
	Email       string
	IsAnonymous bool
}

// ErrCodeInvalid —— access code 不存在或已撤销。
var ErrCodeInvalid = errors.New("access code invalid")

// ErrCodeTaken —— code 已被占用（access_codes.code unique）。
var ErrCodeTaken = errors.New("access code already exists")

// ErrCodeExpired —— access code 过期。
var ErrCodeExpired = errors.New("access code expired")

// ErrMemberQuotaReached —— 这张码的名字(member)数已满 max_members,新名字被拒。
var ErrMemberQuotaReached = errors.New("member quota reached for code")

// ErrMemberNotFound —— 按 id 找 member 没找到(client 存的 member_id 失效)。
var ErrMemberNotFound = errors.New("code member not found")

// ErrTurnQuotaReached —— 这个 session 已用满 max_turns_per_session。
var ErrTurnQuotaReached = errors.New("turn quota reached for session")
