// adapter.go — Phase B-4: binds capreg.MCPBinding to the mcp-go server.
//
// Each capability implements OwnerMCPBinding and returns a
// {Name, Description, InputSchema, Handler}; this adapter uniformly does
// owner_id resolve + panic recover + result translation; the Handler
// receives an already-verified ownerID, with raw as the args JSON.

package mcphandle

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"runtime/debug"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// PanicResultMarker — the error prefix returned to the client after a
// handler panics. Exported for the guard: e2e calls every owner tool one
// by one and uses this marker to tell "the tool crashed" apart from "the
// tool correctly rejected an empty input". Without it, both are just an
// isError, and the guard is blind.
const PanicResultMarker = "internal error: capability handler panicked"

// registerCapabilities —— walks registry.OwnerMCPBindings() and installs
// each binding into the mcp-go server. If corpus / page / job-loop etc.
// also have an MCP face, it automatically shows up in the owner MCP's
// tools/list.
func registerCapabilities(srv *server.MCPServer, reg *capreg.Registry, log *slog.Logger) {
	for _, b := range reg.OwnerMCPBindings() {
		mcpTool := mcpgo.NewToolWithRawSchema(b.Name, b.Description, b.InputSchema)
		srv.AddTool(mcpTool, wrapCapabilityHandler(b.Handler, b.Name, log))
	}
}

// wrapCapabilityHandler —— the standard owner-side MCP execution wrapper:
//   - panic recover (a handler bug should not take down the whole MCP server)
//   - owner_id resolve (HTTPContextFunc already put it in ctx; read it out here)
//   - args JSON marshal (mcp-go hands over map[string]any; uniformly
//     serialize it into raw for the Handler)
//   - MCPResult → *CallToolResult translation
func wrapCapabilityHandler(
	h capreg.MCPHandler, toolName string, log *slog.Logger,
) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		// The result is captured via a closure variable, rewritten inside recover —
		// this repo bans named return values, and "must still return a result
		// after a panic" needs somewhere to land it. It used to only log without
		// assigning, so after a panic the function returned (nil, nil): the
		// owner's MCP client got "success but empty" — a crashed tool looked
		// identical to "this tool just has no output".
		var out *mcpgo.CallToolResult
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Error("mcp capability handler panic",
						"tool", toolName, "panic", r, "stack", string(debug.Stack()))
					out = mcpgo.NewToolResultError(PanicResultMarker + ": " + toolName)
				}
			}()
			out = runCapabilityHandler(ctx, h, &req)
		}()
		return out, nil
	}
}

func runCapabilityHandler(
	ctx context.Context, h capreg.MCPHandler, req *mcpgo.CallToolRequest,
) *mcpgo.CallToolResult {
	ownerID := OwnerIDFrom(ctx)
	if ownerID == "" {
		return mcpgo.NewToolResultError("unauthorized: invalid or missing api token")
	}
	raw, mErr := marshalToolArgs(req.GetArguments())
	if mErr != nil {
		return mcpgo.NewToolResultError("invalid arguments: " + mErr.Error())
	}
	result := h(ctx, ownerID, raw)
	if !result.OK {
		return mcpgo.NewToolResultError(result.Text)
	}
	if len(result.Embeddings) == 0 {
		return mcpgo.NewToolResultText(result.Text)
	}
	return buildMultiContentResult(&result)
}

// buildMultiContentResult —— text + N binary embeds → CallToolResult. Since
// E-12, applications.commit uses (text JSON + PDF blob).
func buildMultiContentResult(r *capreg.MCPResult) *mcpgo.CallToolResult {
	content := make([]mcpgo.Content, 0, 1+len(r.Embeddings))
	content = append(content,
		mcpgo.TextContent{Type: mcpgo.ContentTypeText, Text: r.Text})
	for i := range r.Embeddings {
		e := &r.Embeddings[i]
		content = append(content, mcpgo.NewEmbeddedResource(mcpgo.BlobResourceContents{
			URI:      e.URI,
			MIMEType: e.MIMEType,
			Blob:     base64.StdEncoding.EncodeToString(e.Blob),
		}))
	}
	return &mcpgo.CallToolResult{Content: content}
}

func marshalToolArgs(args map[string]any) (json.RawMessage, error) {
	if len(args) == 0 {
		return json.RawMessage(`{}`), nil
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, fmt.Errorf("marshal tool args: %w", err)
	}
	return raw, nil
}
