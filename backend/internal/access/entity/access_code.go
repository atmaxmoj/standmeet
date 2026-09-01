// access_code.go —— 访客访问码（aggregate root）+ 子实体 CodeMember。
// revoke 只在 code 级别（status='revoked'）做；单 member 不可单独 revoke ——
// 那种复杂度不值。

package entity

import (
	"errors"
	"time"
)

// Code —— 访客访问码。
//
//   - MaxMembers nil → 不限；这张码最多容纳几个不同名字(member = 一个人 =
//     一段续聊的会)。满了之后新名字被拒(visitor 见 "code 已满");已有名字续。
//   - MaxTurnsPerSession   nil → 不限；单 session 内 visitor turn 上限。
//   - Status 'active' / 'revoked'（过期由 ExpiresAt 计算，不写状态字段）。
//   - AssumedRoleID 必填，指向 owner 的 roles 行 id；session issue 时 freeze
//     出 [[role_snapshot]]。owner 不显式选 → usecase 默认绑 public。
//
// #135:per-code 预约配额不在内核 —— booker 能力自管(它的 capstore),内核不认。
type Code struct {
	CreatedAt            time.Time
	ExpiresAt            *time.Time
	MaxMembers           *int32
	MaxTurnsPerSession   *int32
	RequireGhostEvidence *bool
	PromptID             *string
	LimitPerPeriod       *PeriodLimit
	Code                 string
	OwnerID              string
	Label                string
	Purpose              string
	Status               string
	AssumedRoleID        string
	InlinePrompt         string
	CustomPageSlug       string
	ProviderID           string
	ID                   string
	Ghosts               []string
}

// PeriodLimit —— 一张码每个周期能花多少(可再生速率闸)。max_turns_per_session 是每场、
// gas 是总量;这一个是**每周期自动回满**的桶。公开 embed 码用它防被薅。
type PeriodLimit struct {
	// Unit —— 'turns' 或 'gas'。turns 数 dialog 条数,gas 数 token 用量。
	Unit          string `json:"unit"`
	Amount        int64  `json:"amount"`
	PeriodSeconds int64  `json:"period_seconds"`
}

// TurnsWindow —— 一个有效 turns 闸的两个数：额度 + 滚动窗口秒。
type TurnsWindow struct {
	Amount        int64
	PeriodSeconds int64
}

// TurnsCap —— 若这是一个有效的 turns 闸，返回 *TurnsWindow；否则 nil（没挂 / 不是 turns /
// 数值非法）。nil 接收者安全（没挂闸就是没挂闸）。用指针而不是 (amount, period, ok) 三返回值：
// 返回值上限是 2，一个 nil 指针就把"有没有"说清楚了（跟 EmbedForCode 同一种取舍）。
func (p *PeriodLimit) TurnsCap() *TurnsWindow {
	if p == nil || p.Unit != "turns" || p.Amount <= 0 || p.PeriodSeconds <= 0 {
		return nil
	}
	return &TurnsWindow{Amount: p.Amount, PeriodSeconds: p.PeriodSeconds}
}

// CreateAccessCodeInput —— 创建 access code 入参 (domain-level，供 MCP cap +
// 任何下游写入 Code 用)。access.CreateCodeInput 是 repo-local 镜像，
// CodeRepo.CreateAccessCode 把本类型转过去。
type CreateAccessCodeInput struct {
	ExpiresAt          *time.Time
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	PromptID           *string
	OwnerID            string
	Code               string
	Label              string
	Purpose            string
	AssumedRoleID      string
	InlinePrompt       string
	// ProviderID —— 这张码指定的 provider(空 = 继承 role,再默认)。
	ProviderID string
	Ghosts     []string
}

// CodeMember —— 一个 access code 下的一个具名访客（Code 聚合子实体）。
// 同一个 code 同一个 display_name 是唯一 row。revoke 只在 Code 级别
// 做（code.status='revoked'），不针对单个 member——后者复杂度不值。
type CodeMember struct {
	LastSeenAt  time.Time
	ID          string
	CodeID      string
	DisplayName string
	Email       string
	IsAnonymous bool
}

// CodeStatusActive / CodeStatusRevoked —— access_codes.status 的词表(schema CHECK 与此一致)。
const (
	CodeStatusActive  = "active"
	CodeStatusRevoked = "revoked"
)

// ErrCodeInvalid —— 这张 access code **不存在**。
//
// 曾经它同时表示「已撤销」,于是访客那句拒绝只能合成「invalid or revoked」—— 而这两种人的
// 下一步是相反的:打错字该重新粘一次,被撤销该去要一张新的(F-D-6)。撤销现在是 ErrCodeRevoked。
var ErrCodeInvalid = errors.New("access code invalid")

// ErrCodeRevoked —— 这张 access code 存在,但 owner 撤销了它。
var ErrCodeRevoked = errors.New("access code revoked")

// ErrCodeTaken —— code 已被占用（access_codes.code unique）。
var ErrCodeTaken = errors.New("access code already exists")

// ErrCodeExpired —— access code 过期。
var ErrCodeExpired = errors.New("access code expired")

// ErrMemberQuotaReached —— 这张码的名字(member)数已满 max_members,新名字被拒。
var ErrMemberQuotaReached = errors.New("member quota reached for code")

// ErrMemberNotFound —— 按 id 找 member 没找到(client 存的 member_id 失效)。
var ErrMemberNotFound = errors.New("code member not found")

// ErrDenialKindUnknown —— 一条拒绝的 kind 不是 capability / skill / corpus 之一。
var ErrDenialKindUnknown = errors.New("denial kind must be capability, skill or corpus")

// ErrTurnQuotaReached —— 这个 session 已用满 max_turns_per_session。
var ErrTurnQuotaReached = errors.New("turn quota reached for session")

// ErrGasExhausted —— 这一场挂的那箱油空了(#7)。跟轮数用满是同一类:不是出错,
// 是"这次不能发",所以也走 403 + 一句人话,而不是 5xx。
var ErrGasExhausted = errors.New("provider gas exhausted")
