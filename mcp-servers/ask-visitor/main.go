// Package main —— ask_visitor as a standalone, self-contained external MCP server.
//
// This is the externalized form of the former in-process ask_visitor capability.
// It owns everything it needs and depends on nothing in the core:
//   - the ask_visitor tool (echoes the LLM's structured question back)
//   - its system-prompt fragment, declared via MCP `instructions`
//   - the ReturnDirectly semantics, declared via the tool's `_meta`
//   - its own rendering, served as a ui:// card resource (sandboxed in chat)
//
// Transport: default HTTP (compose service); `--stdio` for a spawned child.
// The core discovers it as a bundled-builtin MCP app (origin=builtin), acl=always,
// raw_tool_names=true so the tool stays canonical `ask_visitor`.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const (
	defaultPort       = "9200"
	uiCardURI         = "ui://ask-visitor/card.html"
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 30 * time.Second
	writeTimeout      = 30 * time.Second
)

func main() {
	srv := server.NewMCPServer("ask-visitor", "1.0.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(false, false),
		server.WithInstructions(instructions))
	srv.AddTool(askVisitorTool(), askVisitorHandler)
	srv.AddResource(uiCardResource(), uiCardHandler)

	if len(os.Args) > 1 && os.Args[1] == "--stdio" {
		if err := server.ServeStdio(srv); err != nil {
			log.Fatalf("serve stdio: %v", err)
		}
		return
	}
	serveHTTP(srv)
}

func serveHTTP(srv *server.MCPServer) {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	httpSrv := server.NewStreamableHTTPServer(srv, server.WithEndpointPath("/mcp"))
	mux := http.NewServeMux()
	mux.Handle("/mcp", httpSrv)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	httpServer := &http.Server{
		Addr: ":" + port, Handler: mux,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
	}
	if err := httpServer.ListenAndServe(); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

// askVisitorTool —— the ask_visitor tool spec + _meta.return_directly so the core
// ends the agent loop and pushes the echoed args as the final result.
func askVisitorTool() mcpgo.Tool {
	t := mcpgo.NewTool("ask_visitor",
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
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{"return_directly": true})
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
	return mcpgo.NewResource(uiCardURI, "ask_visitor card",
		mcpgo.WithMIMEType("text/html"),
		mcpgo.WithResourceDescription("Sandboxed ask_visitor widget (radio/multi/yes_no)."))
}

//nolint:gocritic // mcp-go requires a value-typed request.
func uiCardHandler(
	_ context.Context, _ mcpgo.ReadResourceRequest,
) ([]mcpgo.ResourceContents, error) {
	return []mcpgo.ResourceContents{
		mcpgo.TextResourceContents{URI: uiCardURI, MIMEType: "text/html", Text: cardHTML},
	}, nil
}
