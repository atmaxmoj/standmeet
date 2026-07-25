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
		server.WithResourceCapabilities(false, false),
		server.WithInstructions(instructions))
	srv.AddTool(bookTool(), localHandler(doBook))
	srv.AddTool(listSlotsTool(), localHandler(doListSlots))
	srv.AddTool(sendConfirmationTool(), localHandler(doSendConfirmation))
	srv.AddTool(cancelTool(), localHandler(doCancel))
	srv.AddTool(rescheduleTool(), localHandler(doReschedule))
	srv.AddResource(slotsCardResource(), slotsCardHandler)
	srv.AddResource(bookedCardResource(), bookedCardHandler)
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
	return withCard(mcpgo.NewToolWithRawSchema("calendar_book",
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
		}`)), "booking meeting", bookedCardURI)
}

// sendConfirmationTool —— send the booking confirmation email for the meeting
// just booked in this conversation. Triggered by the booked card's email widget
// (mcp-ui:tool); recipient defaults to the visitor's session email unless they
// typed a different one (backend hard-controls it, D-4). Not for direct agent use.
func sendConfirmationTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("send_confirmation",
		"Send the booking confirmation email for the meeting just booked in this "+
			"conversation. This is triggered by the booking card's email widget — the "+
			"recipient is the visitor's session email unless they typed a different one. "+
			"You do not normally call this directly; the card drives it.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"recipient":{"type":"string",
					"description":"Override recipient address; empty uses the visitor's session email."},
				"tz":{"type":"string","description":"Visitor IANA timezone for rendering body times."}
			}
		}`)), "sending confirmation")
}

// cancelTool —— cancel the meeting booked in this conversation. Triggered by the
// booked card's cancel button (mcp-ui:tool). Isolation is host-side (the trusted
// conversation context), so a visitor can only cancel their own booking. Not for
// direct agent use.
func cancelTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("calendar_cancel",
		"Cancel the meeting just booked in this conversation. This is triggered by "+
			"the booking card's cancel button — it removes the calendar event for the "+
			"booking the visitor made here. You do not normally call this directly.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"event_id":{"type":"string","description":"The booking's google_event_id from the card."}
			}
		}`)), "cancelling booking")
}

// rescheduleTool —— move the meeting booked in this conversation to a new time. Isolation is
// host-side (trusted conversation context): a visitor can only reschedule their own booking, and
// only into an owner-available slot (the host re-runs booking policy + freebusy). Atomic on the
// host: the new slot is booked first — if it's unavailable the original booking is left untouched.
func rescheduleTool() mcpgo.Tool {
	return withCard(mcpgo.NewToolWithRawSchema("calendar_reschedule",
		"Move the meeting booked in this conversation to a new time. Provide the booking's "+
			"event_id (from the card) plus the duration and one or more visitor-confirmed new "+
			"preferred start times (RFC3339). The new slot must be free and pass the owner's "+
			"booking policy; if not, the original booking stays and you get the conflict back.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"event_id":{"type":"string","description":"The booking's google_event_id from the card."},
				"duration_min":{"type":"integer","minimum":15,"maximum":180},
				"preferred_times":{
					"type":"array",
					"items":{"type":"string","description":"RFC3339"},
					"minItems":1
				}
			},
			"required":["event_id","duration_min","preferred_times"]
		}`)), "rescheduling meeting", bookedCardURI)
}

func slotsCardResource() mcpgo.Resource {
	return mcpgo.NewResource(slotsCardURI, "slots card",
		mcpgo.WithMIMEType(slotsCardMIME),
		mcpgo.WithResourceDescription("Sandboxed calendar_list_slots day picker."))
}

func slotsCardHandler(
	_ context.Context, _ mcpgo.ReadResourceRequest,
) ([]mcpgo.ResourceContents, error) {
	return []mcpgo.ResourceContents{
		mcpgo.TextResourceContents{URI: slotsCardURI, MIMEType: slotsCardMIME, Text: slotsCardHTML},
	}, nil
}

func bookedCardResource() mcpgo.Resource {
	return mcpgo.NewResource(bookedCardURI, "booked card",
		mcpgo.WithMIMEType(bookedCardMIME),
		mcpgo.WithResourceDescription("Sandboxed calendar_book confirmation (cancel / send-confirmation)."))
}

func bookedCardHandler(
	_ context.Context, _ mcpgo.ReadResourceRequest,
) ([]mcpgo.ResourceContents, error) {
	return []mcpgo.ResourceContents{
		mcpgo.TextResourceContents{URI: bookedCardURI, MIMEType: bookedCardMIME, Text: bookedCardHTML},
	}, nil
}

// withCard —— like progressLabel but also declares the tool's ui:// card on `_meta`.
func withCard(t mcpgo.Tool, label, cardURI string) mcpgo.Tool {
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{
		"progress_label": label,
		"ui_resource":    cardURI,
	})
	return t
}

func listSlotsTool() mcpgo.Tool {
	return withCard(mcpgo.NewToolWithRawSchema("calendar_list_slots",
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
		}`)), "listing slots", slotsCardURI)
}

// session —— the trusted context the host plants on the tool-call `_meta`. 只带通用身份
// (owner/code/conversation/role/visitor);booking 专属配置(quota / policy / notify)都在
// booker 自己的 capstore,按这些 id 读 —— 核心 session 一个 booking 字段都不带。
type session struct {
	OwnerID        string
	CodeID         string
	ConversationID string
	VisitorName    string
	VisitorEmail   string
	RoleID         string
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

// localHandler —— run a sandbox capability fn: pull the trusted session off `_meta`
// (host-planted, never LLM-controlled) + the raw tool arguments, return its wire
// JSON straight through. The capability logic runs HERE in the sandbox; it reaches
// the calendar connector / its own storage / owner meta only via the fixed
// reach-back vocabulary (gateway.go), never a host op it defines itself.
func localHandler(fn func(session, json.RawMessage) string) server.ToolHandlerFunc {
	return func(_ context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		s := sessionFromMeta(req)
		args, merr := json.Marshal(req.GetArguments())
		if merr != nil {
			return toolErr(merr), nil
		}
		return mcpgo.NewToolResultText(fn(s, json.RawMessage(args))), nil
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
