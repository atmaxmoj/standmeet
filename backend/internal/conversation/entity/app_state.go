package entity

// AppStateRef —— locates one cell of MCP App state: member (the durable
// identity behind a session) x mcp_id (derived by the backend from the
// tool) x key. owner follows member (multi-tenancy + cascade). Used by upsert.
type AppStateRef struct {
	OwnerID  string
	MemberID string
	McpID    string
	Key      string
}
