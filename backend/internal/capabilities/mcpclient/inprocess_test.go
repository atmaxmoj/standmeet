// inprocess_test.go —— verifies in-process loading: builds a same-process mcp-go
// server (with a tool / instructions / resource), connects with DialInProcess over the
// in-memory transport, and asserts tools/instructions/resource all work. No network, no
// subprocess, no goroutine —— this is exactly how built-in capabilities load.

package mcpclient_test

import (
	"context"
	"testing"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	mcpgoserver "github.com/mark3labs/mcp-go/server"
	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
)

func buildInProcServer() *mcpgoserver.MCPServer {
	srv := mcpgoserver.NewMCPServer("inproc-fixture", "1.0.0",
		mcpgoserver.WithToolCapabilities(true),
		mcpgoserver.WithResourceCapabilities(false, false),
		mcpgoserver.WithInstructions("inproc instructions"))
	tool := mcpgo.NewTool("greet", mcpgo.WithDescription("greet fixture"))
	tool.Meta = mcpgo.NewMetaFromMap(map[string]any{"return_directly": true})
	srv.AddTool(tool, func(
		_ context.Context, _ mcpgo.CallToolRequest,
	) (*mcpgo.CallToolResult, error) {
		return mcpgo.NewToolResultText("hi"), nil
	})
	res := mcpgo.NewResource("ui://inproc/card", "card", mcpgo.WithMIMEType("text/html"))
	srv.AddResource(res, func(
		_ context.Context, _ mcpgo.ReadResourceRequest,
	) ([]mcpgo.ResourceContents, error) {
		return []mcpgo.ResourceContents{
			mcpgo.TextResourceContents{URI: "ui://inproc/card", Text: "<b>card</b>"},
		}, nil
	})
	return srv
}

func TestInProcess_LoadServerObject(t *testing.T) {
	t.Parallel()
	sess, err := mcpclient.DialInProcess(context.Background(), buildInProcServer())
	require.NoError(t, err)
	t.Cleanup(sess.Close)

	require.Equal(t, "inproc instructions", sess.Instructions())

	tools, err := sess.ListTools(context.Background())
	require.NoError(t, err)
	require.Len(t, tools, 1)
	require.Equal(t, "greet", tools[0].Name)
	require.Equal(t, true, tools[0].Meta["return_directly"])

	html, err := sess.ReadResource(context.Background(), "ui://inproc/card")
	require.NoError(t, err)
	require.Contains(t, html, "<b>card</b>")

	// tools/call over the in-memory transport actually invokes the handler.
	out, cerr := sess.CallTool(context.Background(), "greet", []byte(`{}`), nil)
	require.NoError(t, cerr)
	require.Equal(t, "hi", out)
}
