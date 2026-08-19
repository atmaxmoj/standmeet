// instance.go —— singleton "this deployment" 行的 domain 视图。
// 一个 self-hosted 实例对应一行 instance_settings；多 tenant 时一行 / tenant。

package entity

import (
	"errors"
	"time"
)

// InstanceSettings 是 singleton 行的快照。
type InstanceSettings struct {
	DeployedAt time.Time
	// SetupTokenHash —— 库里存着的那个 hash 本身（没有就是空串）。
	// **只有 bool 是不够的**：发链接的那一侧手里是明文，要判的是「我这份明文哈希之后
	// 等不等于库里这个」。只问"有没有"，就分不出「好着呢」和「两半各存各的」——
	// 而后者正是真实环境里让 owner 永远 claim 不了的那个状态（F-L-56）。
	SetupTokenHash string
	// 三个 bool 排在最后：fieldalignment 要求大的在前，别为了读起来顺手多占一个字。
	IsClaimed         bool
	MultiTenant       bool
	HasSetupTokenHash bool // DB 里 setup_token_hash 是否非 NULL（claim 后清成 NULL）
}

// ErrInstanceAlreadyClaimed —— 重复 claim 同一个 instance（已经过初次 setup）。
var ErrInstanceAlreadyClaimed = errors.New("instance already claimed")

// ErrInvalidSetupToken —— setup token 不匹配（被改、被偷、过期 / 已消费）。
var ErrInvalidSetupToken = errors.New("invalid setup token")

// ErrInstanceSettingsNotFound —— instance_settings 单行查不到（v1 不该
// 发生因为 migration 引导插入；保留 sentinel 给后续 multi-tenant 用）。
var ErrInstanceSettingsNotFound = errors.New("instance settings not found")
