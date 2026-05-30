// mcp_binding.go —— Capability 暴露给 owner-facing MCP server 的接口形态。
// adapter（B-4 加 agentskills/mcp_adapter.go）负责 JSON unmarshal + owner_id
// resolve + envelope translation，Handler 拿到的 raw 已经合法。

package agentskills

import (
	"context"
	"encoding/json"
)

// MCPBinding —— owner-facing MCP server 注册口。
type MCPBinding struct {
	Handler     MCPHandler
	Name        string
	Description string
	InputSchema json.RawMessage
}

// MCPHandler —— Capability 暴露给 owner MCP server 的执行口。
// raw 是 tool input JSON（已校验合法）；返回 result JSON 字符串。
type MCPHandler func(ctx context.Context, ownerID string, raw json.RawMessage) (string, error)
