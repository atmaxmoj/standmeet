// api_token.go —— owner 给 MCP client 颁发的 bearer token 元数据。
// 明文 / hash 在 session 包里，这里只放展示给 owner 的列表字段。

package domain

import "time"

// APIToken 是 owner 的 MCP 鉴权 token（metadata 字段；明文/hash 在 session 包）。
// 对齐 youteacher 简化：无 prefix，无 scope 字段（schema 占位 *）。
type APIToken struct {
	CreatedAt  time.Time
	LastUsedAt *time.Time
	ID         string
	Name       string
}
