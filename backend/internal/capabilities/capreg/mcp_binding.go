// mcp_binding.go — the interface shape a Capability exposes to the
// owner-facing MCP server. The adapter (mcp/adapter.go) handles owner_id
// resolve + panic recover + envelope translation; the raw a Handler receives
// is already valid args JSON (mcp-go has already unmarshaled it), and ownerID
// has already been verified.
//
// When Result.OK=false, Text is treated as an error message and goes through
// mcpgo.NewToolResultError; when OK=true, Text is treated as the success
// payload and goes through mcpgo.NewToolResultText.

package capreg

import (
	"context"
	"encoding/json"
)

// MCPBinding — the registration entry for the owner-facing MCP server.
type MCPBinding struct {
	Handler     MCPHandler
	Name        string
	Description string
	InputSchema json.RawMessage
}

// MCPHandler — the execution entry a Capability exposes to the owner MCP
// server. raw is the tool input JSON args; returns an MCPResult.
type MCPHandler func(ctx context.Context, ownerID string, raw json.RawMessage) MCPResult

// MCPResult — a Handler's return value.
//   - OK=true → Text goes through NewToolResultText (success payload,
//     JSON-encoded); Embeddings go through NewEmbeddedResource, following
//     Text (e.g. the PDF blob from applications.commit).
//   - OK=false → Text goes through NewToolResultError (error message string);
//     Embeddings is ignored.
type MCPResult struct {
	Text       string
	Embeddings []MCPEmbedded
	OK         bool
}

// MCPEmbedded — a binary resource (e.g. PDF / image). Blob is base64-encoded.
// URI is a client-side reference (e.g. "standmeet://application/<id>"),
// MIMEType lets the client decide how to render it.
type MCPEmbedded struct {
	URI      string
	MIMEType string
	Blob     []byte
}

// MCPSuccess — a short constructor for a success result (text only).
func MCPSuccess(payload string) MCPResult { return MCPResult{Text: payload, OK: true} }

// MCPSuccessWithEmbeddings — a success result with text + one or more binary
// embeds.
func MCPSuccessWithEmbeddings(payload string, embs []MCPEmbedded) MCPResult {
	return MCPResult{Text: payload, Embeddings: embs, OK: true}
}

// MCPError — a short constructor for an error result.
func MCPError(msg string) MCPResult { return MCPResult{Text: msg, OK: false} }
