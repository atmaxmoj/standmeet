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
//   - MaxSessionsPerMember nil → 不限；几个 session 数（"5 轮面试" 就 5）。
//   - MaxTurnsPerSession   nil → 不限；单 session 内 visitor turn 上限。
//   - Status 'active' / 'revoked'（过期由 ExpiresAt 计算，不写状态字段）。
type AccessCode struct {
	CreatedAt            time.Time
	ExpiresAt            *time.Time
	MaxSessionsPerMember *int32
	MaxTurnsPerSession   *int32
	ID                   string
	OwnerID              string
	Code                 string
	Label                string
	Purpose              string
	Status               string
	IncludedTags         []string
	ExcludedTags         []string
	SuggestedQuestions   []string
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

// ErrCodeExpired —— access code 过期。
var ErrCodeExpired = errors.New("access code expired")

// ErrSessionQuotaReached —— 这个 member 已用满 max_sessions_per_member。
var ErrSessionQuotaReached = errors.New("session quota reached for member")

// ErrTurnQuotaReached —— 这个 session 已用满 max_turns_per_session。
var ErrTurnQuotaReached = errors.New("turn quota reached for session")
