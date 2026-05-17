// Package domain 是 DDD 的内核：纯实体、值对象、错误。
// 不依赖任何 internal 包；不依赖任何 infra 库。
package domain

import (
	"errors"
	"time"
)

// Owner 是单 owner instance 的 owner profile。
// 字段顺序按 pointer/int/string 对齐 fieldalignment。
type Owner struct {
	CreatedAt time.Time
	ID        string
	Email     string
	Handle    string
	FullName  string
	Location  string
}

// CreateOwnerInput 是 usecase 层传入 Repository 的创建参数。
// PasswordHash 已经 hash 好（usecase 负责调 hasher），Repository 不碰明文。
type CreateOwnerInput struct {
	Email        string
	PasswordHash string
	Handle       string
	FullName     string
}

// InstanceSettings 是 singleton 行的快照。
type InstanceSettings struct {
	DeployedAt  time.Time
	IsClaimed   bool
	MultiTenant bool
}

// APIToken 是 owner 的 MCP 鉴权 token（metadata 字段；明文/hash 在 session 包）。
// 对齐 youteacher 简化：无 prefix，无 scope 字段（schema 占位 *）。
type APIToken struct {
	CreatedAt  time.Time
	LastUsedAt *time.Time
	ID         string
	Name       string
}

// RawEntry —— owner 通过 MCP push 进 corpus 的"半成品"，未整理。
type RawEntry struct {
	CreatedAt      time.Time
	PromotedTo     *string
	ID             string
	OwnerID        string
	Body           string
	Source         string
	Tags           []string
	FlaggedPrivate bool
	Archived       bool
}

// WikiEntry —— curated 内容，树状组织（parent_id 形成森林，root = ParentID==nil）。
// Path 是 induced —— 从 ParentID 链 walk 出来，repo 提供 ComputePath() 算。
type WikiEntry struct {
	CreatedAt    time.Time
	UpdatedAt    time.Time
	ParentID     *string
	ID           string
	OwnerID      string
	Title        string
	Body         string
	Visibility   string // 'public' | 'on_request' | 'private'
	Tags         []string
	SourceRawIDs []string
}

// ErrWikiNotFound —— 按 id 查 wiki 未命中。
var ErrWikiNotFound = errors.New("wiki entry not found")

// ErrRawNotFound —— 按 id 查 raw 未命中。
var ErrRawNotFound = errors.New("raw entry not found")

// Sentinel errors 让 usecase / routes 层能 errors.Is 上做精确分支。
var (
	// ErrInstanceAlreadyClaimed —— 重复 claim 同一个 instance（已经过初次 setup）。
	ErrInstanceAlreadyClaimed = errors.New("instance already claimed")
	// ErrInvalidSetupToken —— setup token 不匹配（被改、被偷、过期 / 已消费）。
	ErrInvalidSetupToken = errors.New("invalid setup token")
	// ErrEmailTaken —— claim 时 email 已被占用（v1 不该发生但保留）。
	ErrEmailTaken = errors.New("email already taken")
	// ErrHandleTaken —— claim 时 handle 已被占用。
	ErrHandleTaken = errors.New("handle already taken")
	// ErrOwnerNotFound —— 按 id / email 查 owner 未命中（login 时不暴露"用户存在与否"）。
	ErrOwnerNotFound = errors.New("owner not found")
	// ErrUnauthorized —— 鉴权失败（密码错、session 失效、token 错等的统一外部码）。
	ErrUnauthorized = errors.New("unauthorized")
)
