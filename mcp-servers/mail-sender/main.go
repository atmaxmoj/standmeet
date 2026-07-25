// Command mail-sender —— the externalized mail.send capability as a sandboxed stdio MCP server
// (origin=builtin). Owns NO data/credentials: it reads the trusted session context off each
// tool-call `_meta` (planted by the host) and forwards the call to the host's "send" op over a
// bind-mounted unix socket (MAIL_SENDER_SOCKET), staying fully network-isolated. The host runs the
// real MailContract.Send through the active mail connector (openapi SaaS or SMTP — the plugin can't
// tell). Mirrors the booker plugin's shape; the result wire ({ok,...}) is the agent-facing result.
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

const socketEnv = "MAIL_SENDER_SOCKET"

const instructions = `You can send an email on the owner's behalf through their configured mail ` +
	`connector. Use send_email only when the visitor has clearly asked you to email them (or the ` +
	`owner) something concrete — a summary, a link, a follow-up. Gather the subject and body first; ` +
	`the recipient defaults to the email the visitor gave when they arrived unless they name another.`

func main() {
	srv := server.NewMCPServer("mail-sender", "1.0.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(false, false),
		server.WithInstructions(instructions))
	srv.AddTool(sendEmailTool(), sendEmailHandler)
	if err := server.ServeStdio(srv); err != nil {
		fmt.Fprintln(os.Stderr, "mail-sender:", err)
		os.Exit(1)
	}
}

func sendEmailTool() mcpgo.Tool {
	t := mcpgo.NewToolWithRawSchema("send_email",
		"Send an email through the owner's mail connector. Provide subject and body; recipient "+
			"defaults to the visitor's session email unless they give a different address.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"recipient":{"type":"string","description":"Override recipient; empty uses the visitor's session email."},
				"subject":{"type":"string"},
				"body":{"type":"string"}
			},
			"required":["subject","body"]
		}`))
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{"progress_label": "sending email"})
	return t
}

// session —— trusted context the host plants on the tool-call `_meta`.
type session struct {
	OwnerID      string
	VisitorEmail string
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
	return session{OwnerID: str(raw, "owner_id"), VisitorEmail: str(raw, "visitor_email")}
}

func str(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

type sendEmailArgs struct {
	Recipient string `json:"recipient"`
	Subject   string `json:"subject"`
	Body      string `json:"body"`
}

// sendEmailHandler —— D-4 recipient hard-control done sandbox-side (to = args.recipient, else the
// visitor's session email — never an LLM-chosen arbitrary address), then reach back through the
// FIXED-vocabulary op connector.invoke("mail","send"). No bespoke host op: the host just runs the
// active mail connector's send verb. Result wire ({ok:true} / folded error) is the agent result.
func sendEmailHandler(_ context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	s := sessionFromMeta(req)
	raw, merr := json.Marshal(req.GetArguments())
	if merr != nil {
		return toolErr(merr), nil
	}
	var args sendEmailArgs
	if uerr := json.Unmarshal(raw, &args); uerr != nil {
		return toolErr(uerr), nil
	}
	to := args.Recipient
	if to == "" {
		to = s.VisitorEmail
	}
	sendArgs, aerr := json.Marshal(map[string]string{
		"to": to, "subject": args.Subject, "body": args.Body,
	})
	if aerr != nil {
		return toolErr(aerr), nil
	}
	resp, err := gwConnectorInvoke(s.OwnerID, "mail", "send", sendArgs)
	if err != nil {
		return toolErr(err), nil
	}
	return mcpgo.NewToolResultText(string(resp)), nil
}

func toolErr(err error) *mcpgo.CallToolResult {
	return mcpgo.NewToolResultText(fmt.Sprintf(`{"ok":false,"error":%q}`, err.Error()))
}

// callHost —— one line-JSON request/response over the host unix socket bound at MAIL_SENDER_SOCKET.
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
