// Command retrieval —— the externalized corpus.retrieval capability as a sandboxed
// stdio MCP server (origin=builtin). It owns NO data: it reads the trusted session
// context off each tool-call `_meta` (planted by the host — owner id + the frozen
// corpus-ACL scope) and forwards the call to the host's narrow "corpus_search" /
// "corpus_read" / "corpus_list" ops over a bind-mounted unix socket
// (STANDMEET_HOST_SOCKET), staying fully network-isolated. The host runs the real
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

// socketEnv —— 宿主注入的 host socket 路径。名字对所有能力都一样(见 booker 的同名常量)。
const socketEnv = "STANDMEET_HOST_SOCKET"

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
	srv.AddTool(readOnly(mapTool()), opHandler("corpus_map"))
	srv.AddTool(readOnly(resolveTool()), opHandler("corpus_resolve"))
	srv.AddTool(readOnly(peekTool()), opHandler("corpus_peek"))
	srv.AddTool(readOnly(grepTool()), opHandler("corpus_grep"))
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

func mapTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("corpus_map",
		"Get a birds-eye SKELETON of the corpus: the high-level node tree with a count of "+
			"entries under each. Call this FIRST on a broad question — it shows where the "+
			"material is (which branches are big) so you don't search blind. Omit `under` for "+
			"the whole corpus, or pass a node path to zoom into that branch. `budget` bounds "+
			"the size (default is a screenful); dense branches are expanded, sparse ones stay "+
			"collapsed with their count — drill a collapsed branch with corpus_map(under=path) "+
			"or corpus_list.",
		json.RawMessage(`{
			"type": "object",
			"properties": {
				"under": {"type": "string"},
				"budget": {"type": "integer"}
			}
		}`)), "mapping corpus")
}

func resolveTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("corpus_resolve",
		"Turn a NAME into its exact node path. When a note body links to [[some-note]] or "+
			"you know a title but not its path, resolve the name here instead of guessing a "+
			"path (a wrong path wastes a round). Returns 0+ matching nodes with their paths.",
		json.RawMessage(`{
			"type": "object",
			"properties": {"name": {"type": "string"}},
			"required": ["name"]
		}`)), "resolving name")
}

func peekTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("corpus_peek",
		"Cheaply preview MANY nodes at once: pass a list of paths, get each node's title, "+
			"tags, heading outline, outgoing [[links]], and first line — WITHOUT the full body. "+
			"Use to triage which nodes are worth a full corpus_read after a map or a wide "+
			"search, instead of reading each one blind.",
		json.RawMessage(`{
			"type": "object",
			"properties": {
				"paths": {"type": "array", "items": {"type": "string"}}
			},
			"required": ["paths"]
		}`)), "peeking nodes")
}

// grepTool —— the second search path, and the description is the feature.
//
// The agent picks between this and corpus_search by reading them, so the two must state DIFFERENT
// guarantees: corpus_search is a ranked keyword lookup that tolerates typos and misses what its
// tokenizer cannot cut; this one is exhaustive over exact text and returns the lines themselves.
// If these two descriptions ever drift toward each other, the agent chooses arbitrarily and
// never-miss stops being reachable — which is the whole reason this tool exists.
func grepTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("corpus_grep",
		"Find EVERY place an exact string or regex occurs in the corpus, with the matching "+
			"lines. Exhaustive, not ranked: if the pattern is in a note you can read, that "+
			"note is in the result — no typo tolerance, no stemming, no scoring. Use it when "+
			"the exact words matter (a name, an error string, a phrase you remember "+
			"verbatim, a mid-word fragment), or when corpus_search returned nothing and you "+
			"need certainty rather than another guess. Set fixed:true to search for the "+
			"pattern literally (e.g. \"C++\", \"a.b\").",
		json.RawMessage(`{
			"type": "object",
			"properties": {
				"pattern": {"type": "string",
					"description": "RE2 regex, or a literal string with fixed:true."},
				"fixed": {"type": "boolean",
					"description": "Treat the pattern as literal text, not a regex."},
				"case_sensitive": {"type": "boolean",
					"description": "Default false — matching ignores case."}
			},
			"required": ["pattern"]
		}`)), "grepping corpus")
}

// session —— the trusted context the host plants on the tool-call `_meta`. For retrieval the host
// op needs the owner id + the frozen corpus-ACL SCOPE to re-evaluate readability. The scope is two
// lists, and BOTH must be forwarded: the role's grant AND this code's narrowing. Forwarding only
// the grant makes the host serve exactly what the owner took back on that code — a fail-open, and
// silent (the deny is stored, the owner believes it holds, the plugin drops it on the floor).
type session struct {
	OwnerID        string
	ConversationID string
	CorpusURIs     []string
	CorpusDenials  []string
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
		CorpusDenials:  strSlice(raw, "corpus_denials"),
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
			"corpus_denials":  s.CorpusDenials,
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
// the sandbox at STANDMEET_HOST_SOCKET.
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
