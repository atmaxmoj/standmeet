// Command booker —— the externalized calendar.book capability as a sandboxed
// stdio MCP server (origin=builtin). It owns NO data: it reads the trusted
// session context off each tool-call `_meta` (planted by the host) and forwards
// the call to the host's narrow "book" / "list_slots" ops over a bind-mounted
// unix socket (BOOKER_SOCKET), staying fully network-isolated. The host runs the
// real booking pipeline (policy → freebusy → insert → persist → owner notify);
// this plugin is just the agent-facing tools + their schemas.
//
// Per-visitor identity (which owner's calendar, which code's quota, the visitor's
// name/email, the role) rides the MCP-native `_meta` sidechannel — protocol data
// the host attaches, never the LLM-controlled `arguments` (so a prompt-injected
// owner/code is impossible). The result wire ({ok,...}) is unchanged from the old
// in-process capability, so the frontend cards render identically.
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

const socketEnv = "BOOKER_SOCKET"

func main() {
	srv := server.NewMCPServer("booker", "1.0.0",
		server.WithToolCapabilities(true),
		server.WithInstructions(instructions))
	srv.AddTool(bookTool(), opHandler("book"))
	srv.AddTool(listSlotsTool(), opHandler("list_slots"))
	if err := server.ServeStdio(srv); err != nil {
		fmt.Fprintln(os.Stderr, "booker:", err)
		os.Exit(1)
	}
}

// progressLabel —— set the throbber label the host surfaces while the tool runs.
func progressLabel(t mcpgo.Tool, label string) mcpgo.Tool {
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{"progress_label": label})
	return t
}

func bookTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("calendar_book",
		"Book a meeting on the owner's Google Calendar. Only call after you have "+
			"gathered topic, duration (15-180 minutes), and one or more "+
			"visitor-confirmed preferred start times in RFC3339 format. The invite "+
			"goes to the email the visitor gave when they entered (if any) — you do "+
			"not supply a recipient.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"topic":{"type":"string"},
				"duration_min":{"type":"integer","minimum":15,"maximum":180},
				"preferred_times":{
					"type":"array",
					"items":{"type":"string","description":"RFC3339"},
					"minItems":1
				}
			},
			"required":["topic","duration_min","preferred_times"]
		}`)), "booking meeting")
}

func listSlotsTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("calendar_list_slots",
		"List available [start, end] slots on the owner's calendar between "+
			"from_rfc3339 and until_rfc3339 that pass booking policy and don't "+
			"overlap any busy window. Returns up to 50 slots. Use this before "+
			"calendar_book so the visitor can pick an actual free time.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"from_rfc3339":{"type":"string","description":"Search window start (RFC3339)."},
				"until_rfc3339":{"type":"string","description":"Search window end (RFC3339)."},
				"duration_min":{"type":"integer","minimum":15,"maximum":180,
					"description":"Slot length in minutes."},
				"step_min":{"type":"integer","minimum":15,"maximum":120,
					"description":"Enumeration step in minutes (default 30)."}
			},
			"required":["from_rfc3339","until_rfc3339","duration_min"]
		}`)), "listing slots")
}

// session —— the trusted context the host plants on the tool-call `_meta`.
type session struct {
	OwnerID        string
	CodeID         string
	ConversationID string
	VisitorName    string
	VisitorEmail   string
	RoleID         string
}

//nolint:gocritic // mcp-go passes the request by value.
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
		CodeID:         str(raw, "code_id"),
		ConversationID: str(raw, "conversation_id"),
		VisitorName:    str(raw, "visitor_name"),
		VisitorEmail:   str(raw, "visitor_email"),
		RoleID:         str(raw, "role_id"),
	}
}

func str(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

// opHandler —— forward the tool call to the named host op: session fields off
// `_meta` + the raw tool arguments, return the host's JSON wire straight through
// (or a folded error). The host's reply IS the agent-facing result.
func opHandler(op string) server.ToolHandlerFunc {
	return func(_ context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		s := sessionFromMeta(req)
		args, merr := json.Marshal(req.GetArguments())
		if merr != nil {
			return toolErr(merr), nil
		}
		resp, err := callHost(map[string]any{
			"op":              op,
			"owner_id":        s.OwnerID,
			"code_id":         s.CodeID,
			"conversation_id": s.ConversationID,
			"visitor_name":    s.VisitorName,
			"visitor_email":   s.VisitorEmail,
			"role_id":         s.RoleID,
			"args":            json.RawMessage(args),
		})
		if err != nil {
			return toolErr(err), nil
		}
		return mcpgo.NewToolResultText(string(resp)), nil
	}
}

func toolErr(err error) *mcpgo.CallToolResult {
	return mcpgo.NewToolResultText(fmt.Sprintf(`{"ok":false,"error":%q}`, err.Error()))
}

// callHost —— one line-JSON request/response over the host unix socket bound into
// the sandbox at BOOKER_SOCKET.
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
