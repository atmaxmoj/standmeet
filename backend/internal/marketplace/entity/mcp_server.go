// mcp_server.go —— owner 注册的外部 MCP server。InviteCode 可以绑一组
// mcp_server_ids；visitor chat 时 backend 作为 MCP client 连接外部 server，
// 拉它的 tools 加入 visitor 可调用的工具列表（前缀 `ext_<server>_<tool>`）。
//
// 设计源自 legacy standmeet-server/backend/domain/iam/entities.py:McpServer，
// 但落进 owner_id 实现 multi-tenant、auth_header_value 加密入 cryptobox
// 跟 BYOAI key 同套模式 (避免 plaintext token 落盘)。
//
// AuthHeaderValueEnc 在 cryptobox.Decrypt 前是密文 bytes；空 = 无 auth。

package entity

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

// DialableMCPServer —— 同一台外部 server **已经可以去拨**的样子:认证头是开好的明文。
//
// 跟 MCPServerConfig 是两副面孔,区别是**信任级别,由类型承载**:
//
//	MCPServerConfig    存起来的样子,认证头是密文。内侧(域、装配、路由)只见得到这一种。
//	DialableMCPServer  拨号用的样子,认证头已开封。只有出站那一侧造得出来。
//
// 分成两个类型而不是给一个类型加个字段:加字段的话"开没开"要靠调用方自己记得看,
// 而忘了看的失败方向是**带着密文去拨号**——对面只会回一个 401,不会告诉你为什么。
// (跟 owner key / 访客 BYOAI key 分成两个类型是同一条规矩。).
type DialableMCPServer struct {
	ID          string
	OwnerID     string
	Name        string
	URL         string
	AuthHeader  MCPAuthHeader
	GrantedDeps []string
}

// MCPAuthHeader —— 拨号时带的那一对头。Name 空 = 这台 server 不要认证。
// Value 是**明文** —— 这个类型只在开封之后存在(见 DialableMCPServer)。
type MCPAuthHeader struct {
	Name  string
	Value string
}

// Headers —— 拨号器要的 map 形态。没有认证就是空 map,不是 nil。
func (h MCPAuthHeader) Headers() map[string]string {
	if h.Name == "" || h.Value == "" {
		return map[string]string{}
	}
	return map[string]string{h.Name: h.Value}
}

// ErrMCPServerNotFound —— server id 不存在或不属于该 owner。
var ErrMCPServerNotFound = errors.New("mcp server not found")

// ErrMCPServerNameTaken —— 同 owner 下 name 重复 (unique constraint)。
var ErrMCPServerNameTaken = errors.New("mcp server name already taken in this owner")
