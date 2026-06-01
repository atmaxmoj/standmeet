// mcp_binding.go —— Capability 暴露给 owner-facing MCP server 的接口形态。
// adapter（mcp/adapter.go）负责 owner_id resolve + panic recover + envelope
// translation；Handler 拿到的 raw 已经是合法 args JSON (mcp-go 已 unmarshal
// 过)，ownerID 已经验过。
//
// Result.OK=false 时 Text 当作 error 消息走 mcpgo.NewToolResultError；
// OK=true 时 Text 当作 success payload 走 mcpgo.NewToolResultText。

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
// raw 是 tool input JSON args；返回 MCPResult。
type MCPHandler func(ctx context.Context, ownerID string, raw json.RawMessage) MCPResult

// MCPResult —— Handler 返回结果。
//   - OK=true → Text 走 NewToolResultText (success payload, JSON-encoded)；
//     Embeddings 走 NewEmbeddedResource 跟在 Text 后面 (e.g. applications.commit
//     的 PDF blob)。
//   - OK=false → Text 走 NewToolResultError (error message string)；
//     Embeddings 忽略。
type MCPResult struct {
	Text       string
	Embeddings []MCPEmbedded
	OK         bool
}

// MCPEmbedded —— 二进制资源 (e.g. PDF / image)。Blob 走 base64 编码。
// URI 是 client-side 引用 (e.g. "standmeet://application/<id>")，MIMEType
// 给 client 决定怎么 render。
type MCPEmbedded struct {
	URI      string
	MIMEType string
	Blob     []byte
}

// MCPSuccess —— 简短构造 success result (text only)。
func MCPSuccess(payload string) MCPResult { return MCPResult{Text: payload, OK: true} }

// MCPSuccessWithEmbeddings —— success result with text + 一/多 binary embed。
func MCPSuccessWithEmbeddings(payload string, embs []MCPEmbedded) MCPResult {
	return MCPResult{Text: payload, Embeddings: embs, OK: true}
}

// MCPError —— 简短构造 error result。
func MCPError(msg string) MCPResult { return MCPResult{Text: msg, OK: false} }
