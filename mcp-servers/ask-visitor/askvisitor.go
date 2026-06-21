// Package askvisitor —— the externalized ask_visitor inward capability as a
// standalone mcp-go server, in its own module (code decoupled from the core).
//
// It is NOT run as a separate service/subprocess. The host imports this package,
// builds the server object via NewMCPServer(), and loads it in-process over an
// in-memory MCP transport — plain method calls, no network, no child process,
// no thread. The host registers it through the same plugin path as any MCP app,
// using the metadata constants below.
//
// It owns everything it needs and depends on nothing in the core:
//   - the ask_visitor tool (echoes the LLM's structured question back)
//   - its system-prompt fragment, declared via MCP `instructions`
//   - ReturnDirectly, declared via the tool's `_meta`
//   - its own rendering, served as a ui:// card resource (sandboxed in chat)
package askvisitor

import (
	"context"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// Plugin metadata —— the host builds its manifest from these (id / acl / raw tool
// name / ui resource). acl=always: exposed in every mode without a role grant.
// raw tool name: the tool stays canonical `ask_visitor`.
const (
	ID           = "ask_visitor"
	Version      = "1"
	UICardURI    = "ui://ask-visitor/card.html"
	UICardMIME   = "text/html"
	ToolName     = "ask_visitor"
	ReturnDirect = true
	ACLAlways    = true
	RawToolNames = true
)

// NewMCPServer —— build the ask_visitor mcp-go server object. The host connects to
// it in-process (no serving loop here).
func NewMCPServer() *server.MCPServer {
	srv := server.NewMCPServer("ask-visitor", "1.0.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(false, false),
		server.WithInstructions(instructions))
	srv.AddTool(askVisitorTool(), askVisitorHandler)
	srv.AddResource(uiCardResource(), uiCardHandler)
	return srv
}

func askVisitorTool() mcpgo.Tool {
	t := mcpgo.NewTool(ToolName,
		mcpgo.WithDescription(
			"Ask the visitor a structured clarifying question when their intent is "+
				"ambiguous. Returns the question metadata; the visitor's choice comes "+
				"back as the next user message."),
		mcpgo.WithString("question", mcpgo.Required(),
			mcpgo.Description("The clarifying question, first-person.")),
		mcpgo.WithString("kind", mcpgo.Required(),
			mcpgo.Description("radio | multi | yes_no")),
		mcpgo.WithArray("options",
			mcpgo.Description("2-6 short options for radio/multi; ignored for yes_no.")),
		mcpgo.WithBoolean("allow_chat",
			mcpgo.Description("If true, show a free-text box alongside the widget.")),
	)
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{"return_directly": ReturnDirect})
	return t
}

// askVisitorHandler —— echo the LLM's args back as a JSON object string. The
// frontend dispatches by kind to render the widget; no DB, no quota, no LLM.
//
//nolint:gocritic // mcp-go requires a value-typed request.
func askVisitorHandler(
	_ context.Context, req mcpgo.CallToolRequest,
) (*mcpgo.CallToolResult, error) {
	return mcpgo.NewToolResultText(marshalArgs(req.GetArguments())), nil
}

func uiCardResource() mcpgo.Resource {
	return mcpgo.NewResource(UICardURI, "ask_visitor card",
		mcpgo.WithMIMEType(UICardMIME),
		mcpgo.WithResourceDescription("Sandboxed ask_visitor widget (radio/multi/yes_no)."))
}

//nolint:gocritic // mcp-go requires a value-typed request.
func uiCardHandler(
	_ context.Context, _ mcpgo.ReadResourceRequest,
) ([]mcpgo.ResourceContents, error) {
	return []mcpgo.ResourceContents{
		mcpgo.TextResourceContents{URI: UICardURI, MIMEType: UICardMIME, Text: cardHTML},
	}, nil
}
