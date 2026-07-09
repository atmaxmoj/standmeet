// Command retrieval —— the externalized corpus.retrieval capability as a sandboxed
// stdio MCP server (origin=builtin). It owns NO data: it reads the trusted session
// context off each tool-call `_meta` (planted by the host — owner id + the frozen
// corpus-ACL scope) and forwards the call to the host's narrow "corpus_search" /
// "corpus_read" / "corpus_list" ops over a bind-mounted unix socket
// (RETRIEVAL_SOCKET), staying fully network-isolated. The host runs the real
// retriever (DB search/read/tree-nav + ACL); this plugin is just the agent-facing
// tools + their schemas.
//
// The result wire is unchanged from the old in-process capability, so citations
// (which the inference layer derives from the corpus_read result {id,genre}) and
// the frontend keep working untouched.
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

const socketEnv = "RETRIEVAL_SOCKET"

func main() {
	srv := server.NewMCPServer("retrieval", "1.0.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(false, false),
		server.WithInstructions(instructions))
	// 四个检索工具全是安全/幂等的读 → 声明 MCP readOnlyHint=true。host 据此放行 HTTP
	// QUERY（RFC 10008）：语义正确的「带 body 的安全查询」入口。
	srv.AddTool(readOnly(searchTool()), opHandler("corpus_search"))
	srv.AddTool(readOnly(readTool()), opHandler("corpus_read"))
	srv.AddTool(readOnly(listTool()), opHandler("corpus_list"))
	srv.AddTool(readOnly(linksTool()), opHandler("corpus_links"))
	srv.AddResource(searchCardResource(), searchCardHandler)
	if err := server.ServeStdio(srv); err != nil {
		fmt.Fprintln(os.Stderr, "retrieval:", err)
		os.Exit(1)
	}
}

// progressLabel —— set the throbber label the host surfaces while the tool runs
// (preserves the in-process capability's per-tool labels through the _meta sidechannel).
func progressLabel(t mcpgo.Tool, label string) mcpgo.Tool {
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{"progress_label": label})
	return t
}

// withCard —— like progressLabel but also declares this tool's ui:// card on `_meta`
// (MCP Apps). corpus_search / corpus_list both point at the one search card.
// readOnly —— 标注工具为 MCP readOnlyHint=true（安全/幂等的读）。host 侧 mcpclient 透传成
// BindingTool.ReadOnly，dispatch 据此放行 HTTP QUERY。
func readOnly(t mcpgo.Tool) mcpgo.Tool {
	t.Annotations.ReadOnlyHint = mcpgo.ToBoolPtr(true)
	return t
}

func withCard(t mcpgo.Tool, label, cardURI string) mcpgo.Tool {
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{
		"progress_label": label,
		"ui_resource":    cardURI,
	})
	return t
}

func searchCardResource() mcpgo.Resource {
	return mcpgo.NewResource(searchCardURI, "corpus hits card",
		mcpgo.WithMIMEType(searchCardMIME),
		mcpgo.WithResourceDescription("Sandboxed corpus_search/corpus_list hits list."))
}

func searchCardHandler(
	_ context.Context, _ mcpgo.ReadResourceRequest,
) ([]mcpgo.ResourceContents, error) {
	return []mcpgo.ResourceContents{
		mcpgo.TextResourceContents{URI: searchCardURI, MIMEType: searchCardMIME, Text: searchCardHTML},
	}, nil
}

func searchTool() mcpgo.Tool {
	return withCard(mcpgo.NewToolWithRawSchema("corpus_search",
		"Search owner's curated corpus by keyword. Returns matching wiki + output "+
			"entries with path, title, genre, summary.",
		json.RawMessage(`{
			"type": "object",
			"properties": {"query": {"type": "string"}},
			"required": ["query"]
		}`)), "searching corpus", searchCardURI)
}

func readTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("corpus_read",
		"Read the full body of a corpus entry by its path (e.g. projects/lucerna). "+
			"Use after search to fetch content.",
		json.RawMessage(`{
			"type": "object",
			"properties": {"path": {"type": "string"}},
			"required": ["path"]
		}`)), "reading entry")
}

func listTool() mcpgo.Tool {
	return withCard(mcpgo.NewToolWithRawSchema("corpus_list",
		"Navigate the wiki tree one level at a time. Omit path to list root entries; "+
			"pass a node's path to list its direct children (empty result means it's a "+
			"leaf). Use page (0-based) to page through a wide level.",
		json.RawMessage(`{
			"type": "object",
			"properties": {
				"path": {"type": "string"},
				"page": {"type": "integer"}
			}
		}`)), "listing entries", searchCardURI)
}

func linksTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("corpus_links",
		"Follow an entry's links (Obsidian-style). Given a path, returns its outgoing "+
			"links (entries it references) and backlinks (entries that reference it). "+
			"One hop only — call again on a neighbor to go deeper. Use to explore related "+
			"notes the owner connected by hand.",
		json.RawMessage(`{
			"type": "object",
			"properties": {"path": {"type": "string"}},
			"required": ["path"]
		}`)), "following links")
}

// session —— the trusted context the host plants on the tool-call `_meta`. For
// retrieval the host op needs the owner id + the frozen corpus-ACL scope (the role
// snapshot's URI glob whitelist) to re-evaluate AllowsCorpus.
type session struct {
	OwnerID        string
	ConversationID string
	CorpusURIs     []string
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
		CorpusURIs:     strSlice(raw, "corpus_uris"),
	}
}

func str(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

func strSlice(m map[string]any, k string) []string {
	raw, ok := m[k].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// opHandler —— forward the tool call to the named host op: owner id + corpus scope
// off `_meta` + the raw tool arguments, return the host's JSON wire straight
// through (or a folded error). The host's reply IS the agent-facing result.
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
			"conversation_id": s.ConversationID,
			"corpus_uris":     s.CorpusURIs,
			"args":            json.RawMessage(args),
		})
		if err != nil {
			return toolErr(err), nil
		}
		return mcpgo.NewToolResultText(string(resp)), nil
	}
}

func toolErr(err error) *mcpgo.CallToolResult {
	return mcpgo.NewToolResultText(fmt.Sprintf(`{"error":%q}`, err.Error()))
}

// callHost —— one line-JSON request/response over the host unix socket bound into
// the sandbox at RETRIEVAL_SOCKET.
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
