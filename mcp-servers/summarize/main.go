// Command summarize —— the externalized summarize_conversation capability as a
// sandboxed stdio MCP server (origin=builtin). It owns NO data: it reads the
// trusted session context off the tool-call `_meta` (planted by the host) and
// calls the host's narrow "summarize" op over a bind-mounted unix socket
// (SUMMARIZE_SOCKET), staying fully network-isolated. The host runs the actual
// report pipeline (transcript -> LLM -> persist); this plugin is just the
// agent-facing tool + its return-directly semantics.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const socketEnv = "SUMMARIZE_SOCKET"

func main() {
	srv := server.NewMCPServer("summarize", "1.0.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(false, false),
		server.WithInstructions(instructions))
	srv.AddTool(summarizeTool(), handleSummarize)
	srv.AddResource(reportCardResource(), reportCardHandler)
	if err := server.ServeStdio(srv); err != nil {
		fmt.Fprintln(os.Stderr, "summarize:", err)
		os.Exit(1)
	}
}

func summarizeTool() mcpgo.Tool {
	t := mcpgo.NewTool("summarize_conversation",
		mcpgo.WithDescription(
			"Generate a polished HTML report summarizing the conversation. Call "+
				"ONLY when the visitor explicitly asks for a summary / recap / report. "+
				"It ends the turn and returns the report, rendered as a card."),
		mcpgo.WithString("focus",
			mcpgo.Description("Optional: what angle to emphasize.")),
	)
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{
		"return_directly": true,
		"ui_resource":     reportCardURI,
		// long_running —— this tool runs a full LLM report generation host-side; it routinely
		// exceeds the generic 15s CallTool cap, which would time the call out mid-generation and
		// leave the inline card blank (F-A-6). The host grants it LongCallTimeout instead.
		"long_running": true,
	})
	return t
}

func reportCardResource() mcpgo.Resource {
	return mcpgo.NewResource(reportCardURI, "report card",
		mcpgo.WithMIMEType(reportCardMIME),
		mcpgo.WithResourceDescription("Sandboxed summarize_conversation report sneak-peek."))
}

func reportCardHandler(
	_ context.Context, _ mcpgo.ReadResourceRequest,
) ([]mcpgo.ResourceContents, error) {
	return []mcpgo.ResourceContents{
		mcpgo.TextResourceContents{URI: reportCardURI, MIMEType: reportCardMIME, Text: reportCardHTML},
	}, nil
}

// session —— the trusted context the host plants on the tool-call `_meta`.
type session struct {
	OwnerID        string
	ConversationID string
	Mode           string
}

func sessionFromMeta(req mcpgo.CallToolRequest) session {
	meta := req.Params.Meta
	if meta == nil {
		return session{}
	}
	raw, ok := meta.AdditionalFields["standmeet/session"].(map[string]any)
	if !ok {
		return session{}
	}
	return session{
		OwnerID:        str(raw, "owner_id"),
		ConversationID: str(raw, "conversation_id"),
		Mode:           str(raw, "mode"),
	}
}

func str(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

// handleSummarize —— run the whole report pipeline HERE (this plugin owns the generation logic),
// reaching back only for core resources (transcript / owner LLM / report-artifact store). Returns the
// report wire {report_id, html, ok} or a folded {ok:false,error}.
func handleSummarize(
	_ context.Context, req mcpgo.CallToolRequest,
) (*mcpgo.CallToolResult, error) {
	s := sessionFromMeta(req)
	out, err := runSummarize(s)
	if err != nil {
		return mcpgo.NewToolResultText(
			fmt.Sprintf(`{"ok":false,"error":%q}`, err.Error())), nil
	}
	return mcpgo.NewToolResultText(out), nil
}

// runSummarize —— the summarize capability's own orchestration:
//
//	conversation.read → build STAR prompt (owned here) → inference.generate (owner LLM) →
//	report.store (host sanitizes untrusted HTML + styled-renders + persists the report artifact).
//
// Every host touch is a FIXED reach-back verb; no summarize-specific host code exists anymore.
func runSummarize(s session) (string, error) {
	msgs, err := gwConversationRead(s.OwnerID, s.ConversationID)
	if err != nil {
		return "", err
	}
	raw, gerr := gwInferenceGenerate(s.OwnerID, s.Mode, summarizeHTMLPrompt,
		[]chatMessage{{Role: "user", Content: buildSummarizeUserPrompt(msgs)}})
	if gerr != nil {
		return "", gerr
	}
	reportID, styled, serr := gwReportStore(s.OwnerID, s.ConversationID, raw)
	if serr != nil {
		return "", serr
	}
	res, merr := json.Marshal(map[string]any{"report_id": reportID, "html": styled, "ok": true})
	if merr != nil {
		return "", fmt.Errorf("marshal summarize result: %w", merr)
	}
	return string(res), nil
}

// callHost —— one line-JSON request/response over the host unix socket bound into
// the sandbox at SUMMARIZE_SOCKET.
func callHost(reqObj map[string]any) ([]byte, error) {
	path := os.Getenv(socketEnv)
	if path == "" {
		return nil, fmt.Errorf("%s not set", socketEnv)
	}
	conn, derr := net.Dial("unix", path)
	if derr != nil {
		return nil, fmt.Errorf("dial host socket: %w", derr)
	}
	defer func() { _ = conn.Close() }()
	line, merr := json.Marshal(reqObj)
	if merr != nil {
		return nil, merr
	}
	if _, werr := conn.Write(append(line, '\n')); werr != nil {
		return nil, fmt.Errorf("write request: %w", werr)
	}
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	if !sc.Scan() {
		return nil, fmt.Errorf("no response from host")
	}
	return sc.Bytes(), nil
}
