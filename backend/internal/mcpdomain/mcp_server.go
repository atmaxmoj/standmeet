// mcp_server.go —— owner 注册的外部 MCP server。InviteCode 可以绑一组
// mcp_server_ids；visitor chat 时 backend 作为 MCP client 连接外部 server，
// 拉它的 tools 加入 visitor 可调用的工具列表（前缀 `ext_<server>_<tool>`）。
//
// 设计源自 legacy standmeet-server/backend/domain/iam/entities.py:McpServer，
// 但落进 owner_id 实现 multi-tenant、auth_header_value 加密入 cryptobox
// 跟 BYOAI key 同套模式 (避免 plaintext token 落盘)。
//
// AuthHeaderValueEnc 在 cryptobox.Decrypt 前是密文 bytes；空 = 无 auth。

package mcpdomain

import (
	"errors"
	"time"
)

// MCPServerConfig —— mcp_servers 行的值对象。
type MCPServerConfig struct {
	CreatedAt          time.Time
	ID                 string
	OwnerID            string
	Name               string
	URL                string
	AuthHeaderName     string
	AuthHeaderValueEnc []byte
	// GrantedDeps —— owner 显式授权这个 ext-mcp server 可接的 connector 依赖名
	// （"calendar"/"smtp"…）。ext-mcp 最低信任：工具声明 Requires 默认不注入句柄，
	// 只有 dep 在这里 = owner 显式同意，才解析暴露。空 = 默认全拒。
	GrantedDeps []string
}

// ErrMCPServerNotFound —— server id 不存在或不属于该 owner。
var ErrMCPServerNotFound = errors.New("mcp server not found")

// ErrMCPServerNameTaken —— 同 owner 下 name 重复 (unique constraint)。
var ErrMCPServerNameTaken = errors.New("mcp server name already taken in this owner")
