package domain

import "time"

// BannedIP —— owner 封掉的一个来源 IP。命中的 IP 在公开 /api/v1 面被 403 挡掉。
// ExpiresAt nil = 永久封；非 nil = 到点自动失效（enforcement 查询带 now() 过滤）。
// Reason 是 owner 自己的备注。
type BannedIP struct {
	ExpiresAt *time.Time
	CreatedAt time.Time
	ID        string
	OwnerID   string
	IP        string
	Reason    string
}

// Active —— 该封禁此刻是否生效（永久，或还没到期）。
func (b *BannedIP) Active(now time.Time) bool {
	return b.ExpiresAt == nil || b.ExpiresAt.After(now)
}
