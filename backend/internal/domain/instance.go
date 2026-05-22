// instance.go —— singleton "this deployment" 行的 domain 视图。
// 一个 self-hosted 实例对应一行 instance_settings；多 tenant 时一行 / tenant。

package domain

import (
	"errors"
	"time"
)

// InstanceSettings 是 singleton 行的快照。
type InstanceSettings struct {
	DeployedAt        time.Time
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
