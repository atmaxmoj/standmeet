package mcpdomain

// AppStateRef —— 一格 MCP App 状态的定位坐标：member（session 背后的耐久身份）×
// mcp_id（后端从 tool 派生）× key。owner 随 member 走（多租户 + 级联）。upsert 用它。
type AppStateRef struct {
	OwnerID  string
	MemberID string
	McpID    string
	Key      string
}
