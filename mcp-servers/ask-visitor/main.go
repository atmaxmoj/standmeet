// Command ask-visitor —— the externalized ask_visitor capability as a sandboxed
// stdio MCP server (origin=builtin). It owns everything it needs and depends on
// nothing in the core: the ask_visitor tool (echoes the LLM's structured question
// back), its system-prompt fragment (MCP `instructions`), ReturnDirectly (the
// tool's `_meta`), and its ui:// card resource. The host launches this binary in a
// bubblewrap sandbox via sandbox_stdio — the SAME path as any third-party plugin;
// "builtin" is just an origin tag. The host never imports this code: the contract
// is the manifest (id/version as data, host-side) + the runtime MCP protocol, not
// a Go dependency. ask_visitor needs no host data, so it gets no HostSockets and
// runs fully network-isolated.
package main

import (
	"context"
	"fmt"
	"os"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const (
	uiCardURI  = "ui://ask-visitor/card.html"
	uiCardMIME = "text/html"
	toolName   = "ask_visitor"
)

func main() {
	srv := server.NewMCPServer("ask-visitor", "1.0.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(false, false),
		server.WithInstructions(instructions))
	srv.AddTool(askVisitorTool(), askVisitorHandler)
	srv.AddResource(uiCardResource(), uiCardHandler)
	if err := server.ServeStdio(srv); err != nil {
		fmt.Fprintln(os.Stderr, "ask-visitor:", err)
		os.Exit(1)
	}
}

func askVisitorTool() mcpgo.Tool {
	t := mcpgo.NewTool(toolName,
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
	// MCP Apps: declare this tool's ui:// card on the tool `_meta`. The host reads
	// it (resources/read) at assembly and renders it sandboxed for this tool.
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{
		"return_directly": true,
		"ui_resource":     uiCardURI,
	})
	return t
}

// askVisitorHandler —— echo the LLM's args back as a JSON object string. The
// frontend dispatches by kind to render the widget; no DB, no quota, no LLM.
func askVisitorHandler(
	_ context.Context, req mcpgo.CallToolRequest,
) (*mcpgo.CallToolResult, error) {
	return mcpgo.NewToolResultText(marshalArgs(req.GetArguments())), nil
}

func uiCardResource() mcpgo.Resource {
	return mcpgo.NewResource(uiCardURI, "ask_visitor card",
		mcpgo.WithMIMEType(uiCardMIME),
		mcpgo.WithResourceDescription("Sandboxed ask_visitor widget (radio/multi/yes_no)."))
}

func uiCardHandler(
	_ context.Context, _ mcpgo.ReadResourceRequest,
) ([]mcpgo.ResourceContents, error) {
	return []mcpgo.ResourceContents{
		mcpgo.TextResourceContents{URI: uiCardURI, MIMEType: uiCardMIME, Text: cardHTML},
	}, nil
}
