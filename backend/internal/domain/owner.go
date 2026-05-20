// Package domain 是 DDD 的内核：纯实体、值对象、错误。
// 不依赖任何 internal 包；不依赖任何 infra 库。
//
// owner.go —— Owner aggregate 的根 + 配置切面值对象。其它 aggregate
// 各自一个文件（access_code / conversation / wiki / raw / custom_page /
// page_content / instance / api_token / access_request）—— 一个文件一个
// 聚合，对 revive max-public-structs ≤5 形成天然约束信号。
package domain

import (
	"errors"
	"time"
)

// Owner 是 owner aggregate 的根。只放"身份"字段——email / handle / 名字 /
// 位置 / 创建时间。各种 setting 不在这里，由 OwnerSettings 聚合内部值对象
// 承载（AI provider / BYOAI / domain 等）。
//
// 字段顺序按 govet fieldalignment：time.Time 在前（内部 ptr at 16）；string
// 集中段。
type Owner struct {
	CreatedAt time.Time
	ID        string
	Email     string
	Handle    string
	FullName  string
	Location  string
}

// OwnerSettings —— owner 聚合的"配置切面"，跟 identity 分开。
// AI / BYOAI / Domain 三组互相独立的 setting；后续加 connector / SEO 配置
// 等也归这里。
//
// 这是 Owner aggregate 的值对象（不是独立 aggregate root），跟着 Owner 一起
// 走事务边界——save AI key 跟 save BYOAI 各自落 DB，但都通过 OwnerRepo。
type OwnerSettings struct {
	AI    OwnerAISettings
	BYOAI OwnerBYOAISettings
}

// OwnerAISettings —— owner 自己的 inference provider 配置（给真访客 chat
// 用）；明文 key 不出 repo，外层只看 KeyConfigured bool。
type OwnerAISettings struct {
	Provider      string // 'anthropic' | 'openai'
	KeyConfigured bool
}

// OwnerBYOAISettings —— "访客自带 key" 模式开关 + 允许的 provider 列表 +
// 给访客看的说明文案。
type OwnerBYOAISettings struct {
	PublicBlurb string
	Providers   []string
	Enabled     bool
}

// CreateOwnerInput 是 usecase 层传入 Repository 的创建参数。
// PasswordHash 已经 hash 好（usecase 负责调 hasher），Repository 不碰明文。
type CreateOwnerInput struct {
	Email        string
	PasswordHash string
	Handle       string
	FullName     string
}

// Owner-scoped sentinel errors. 其它 aggregate 的 sentinel 在各自文件。
var (
	// ErrEmailTaken —— claim 时 email 已被占用（v1 不该发生但保留）。
	ErrEmailTaken = errors.New("email already taken")
	// ErrHandleTaken —— claim 时 handle 已被占用。
	ErrHandleTaken = errors.New("handle already taken")
	// ErrOwnerNotFound —— 按 id / email 查 owner 未命中（login 时不暴露"用户存在与否"）。
	ErrOwnerNotFound = errors.New("owner not found")
	// ErrUnauthorized —— 鉴权失败（密码错、session 失效、token 错等的统一外部码）。
	ErrUnauthorized = errors.New("unauthorized")
)
