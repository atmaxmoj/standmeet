// Package mcpclient wraps an HTTP client for external MCP servers.
//
// Dials with mcp-go's client.NewStreamableHttpClient and does three things:
//  1. Initialize — must handshake before tools can be called
//  2. ListTools  — pulls the tool specs the other side exposes
//  3. CallTool   — actually calls a tool
//
// This layer translates mcp-go's *mcp.Tool / *mcp.CallToolResult into this project's
// own plain string/struct types, so inference / usecase never import mcp-go directly
// (saves cross-layer lint trouble) — the same vendor-boundary discipline as
// anthropic-sdk-go.
package mcpclient

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	mcpgoclient "github.com/mark3labs/mcp-go/client"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

// dialTimeout —— total budget for Initialize + ListTools/ReadResource; past this the
// server counts as unreachable. 20s (not 8s): sandbox_stdio is a cold start —— bwrap
// spinning up namespaces + node/python interpreter cold start + the MCP initialize
// handshake, which under load (assembling one session can start several sandboxes)
// occasionally exceeds 8s, and a tighter timeout misdiagnoses the capability as
// ErrHidden (card/tool vanishes, intermittent flake). A genuinely dead plugin already
// fails fast at the connect stage and never eats this timeout, so the wider budget only
// costs the rare "slow but alive" case.
const dialTimeout = 20 * time.Second

// httpDialTimeout —— total budget for dialing a **remote HTTP** server (an owner-
// registered ext-MCP server).
//
// Much shorter than dialTimeout, because that 20s exists for **sandbox cold start**
// (bwrap namespaces + interpreter cold start), which remote HTTP has none of: the other
// side is either there or it isn't. And an owner mistyping an address is **common**,
// sitting on a path that session assembly hangs off of —— making every visitor wait 20s
// for a bad URL is unacceptable (e2e went red on the spot: the visitor side gave up at
// 15s and the whole assembly went yellow with it).
//
// This budget is **shared** by the streamable + SSE attempts (see dial.go), so adding
// the fallback doesn't lengthen the wait.
const httpDialTimeout = 6 * time.Second

// callTimeout —— the default cap on a single CallTool; a hung external server must not
// drag visitor chat down with it. Sized for fast connector calls.
const callTimeout = 15 * time.Second

// LongCallTimeout —— budget for a tool that itself performs a full LLM round-trip (summarize's
// report generation): the generic 15s callTimeout is sized for quick connector calls and times
// such a tool out MID-GENERATION — the host finishes and persists the report, but the agent already
// gave up, so the inline card renders blank (F-A-6). A tool opts in via `_meta.long_running`.
const LongCallTimeout = 120 * time.Second

// Tool —— a translated tool spec: exposed across packages with a local type, so the
// mcp-go API never leaks. Meta passes through the tool's `_meta` (mcp-go's
// AdditionalFields) untouched: mcpclient doesn't interpret its semantics, only carries
// it; adapters read the agreed-upon keys themselves (e.g. return_directly).
type Tool struct {
	Meta        map[string]any
	Name        string
	Description string
	InputSchema json.RawMessage
	// ReadOnly —— MCP `annotations.readOnlyHint`: the tool is a safe/idempotent read
	// (doesn't change state). Used by dispatch to decide whether it can go over HTTP
	// QUERY (only read-only tools may QUERY, see routes/public/tools.go).
	ReadOnly bool
}

// WithMetaFlag —— declare one boolean `_meta` flag (`long_running`, `return_directly`, …) and
// return the tool. The `_meta` bag is untyped by the MCP spec, so it is built HERE — the boundary
// layer that owns that shape and is the one place `any` is legitimate. Business packages set flags
// through this typed door instead of hand-rolling a `map[string]any`.
func (t *Tool) WithMetaFlag(key string, val bool) *Tool {
	if t.Meta == nil {
		t.Meta = map[string]any{}
	}
	t.Meta[key] = val
	return t
}

// Session —— the state after one external server connection + the initialized
// handshake completes. instructions is the "how to use this server" text the server
// gives in its initialize response (a native MCP field): mcpclient only carries it,
// and the adapter decides to use it as a system-prompt fragment.
// Fields ordered per govet fieldalignment: pointer (8B) → string header (16B) → func (8B).
type Session struct {
	c            *mcpgoclient.Client
	closeFn      func()
	url          string
	instructions string
}

// Instructions —— the usage notes the server declares in its initialize response
// (MCP's `instructions` field); an empty string if the server doesn't provide one.
func (s *Session) Instructions() string {
	if s == nil {
		return ""
	}
	return s.instructions
}

// Close —— releases the transport. Safe to call Close multiple times.
func (s *Session) Close() {
	if s == nil || s.closeFn == nil {
		return
	}
	s.closeFn()
	s.closeFn = nil
}

// ListTools —— pulls every tool the server exposes.
func (s *Session) ListTools(ctx context.Context) ([]Tool, error) {
	lctx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	res, err := s.c.ListTools(lctx, mcpgo.ListToolsRequest{})
	if err != nil {
		return nil, fmt.Errorf("list tools (%s): %w", s.url, err)
	}
	out := make([]Tool, 0, len(res.Tools))
	for i := range res.Tools {
		out = append(out, translateTool(&res.Tools[i]))
	}
	return out, nil
}

// ReadResource —— reads one MCP resource (resources/read), returning its text content
// (multiple TextResourceContents concatenated; blobs are skipped). MCP Apps' ui:// card
// resources fetch their HTML through this path. uri follows a server-defined scheme
// (ui://...); how the server interprets it is the server's own business.
func (s *Session) ReadResource(ctx context.Context, uri string) (string, error) {
	rctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	req := mcpgo.ReadResourceRequest{}
	req.Params.URI = uri
	res, err := s.c.ReadResource(rctx, req)
	if err != nil {
		return "", fmt.Errorf("read resource %s: %w", uri, err)
	}
	return extractResourceText(res), nil
}

// extractResourceText —— concatenates TextResourceContents.Text from a ReadResourceResult.
func extractResourceText(res *mcpgo.ReadResourceResult) string {
	var b strings.Builder
	for i := range res.Contents {
		if tc, ok := res.Contents[i].(mcpgo.TextResourceContents); ok {
			_, _ = b.WriteString(tc.Text)
		}
	}
	return b.String()
}

// Subject —— the session's subject (kind + id). kind is a string, not an enum: this
// layer is a transport boundary that only carries the value from the layer above
// verbatim, and doesn't know how many kinds there are.
type Subject struct {
	Kind string
	ID   string
}

// SessionContext —— the trusted session identity the host passes to a built-in sandbox
// server, riding the tool-call's `_meta` side channel (not the LLM-controlled
// arguments). Typed (business code is barred from bare `any`); the conversion to a map
// is contained in this transport boundary layer. Third-party plugins pass nil → no
// session context.
type SessionContext struct {
	OwnerID string
	// Subject —— whose identity this session runs as (an access code / an outbound
	// key). Plugins record it into the rows they write, and the host counts usage
	// against it. This used to be called CodeID, so rows written on the key path had
	// no subject and quota had nothing to count against (F-B-11).
	Subject        Subject
	ConversationID string
	Mode           string
	VisitorName    string
	VisitorEmail   string
	RoleID         string
	// CorpusScope —— the session's frozen corpus-ACL scope, carried WHOLE so the externalized
	// retrieval plugin's host op can re-evaluate readability host-side without a role lookup.
	//
	// **One opaque blob on purpose.** It used to travel as two named string lists, hand-copied
	// at four seams (host writes _meta → plugin reads → plugin re-sends → host parses). When the
	// scope grew a third member — "this identity reads only what the owner published" — three of
	// those four seams still compiled and the field simply vanished in transit, denying a public
	// visitor everything (F-D-7's fix, caught by its own guard). The plugin has no business
	// knowing the shape of the host's ACL: it forwards these bytes untouched.
	CorpusScope json.RawMessage
	// CapConfig —— this capability's own per-role configuration, frozen into the role snapshot
	// at session start. Opaque here: the host carries the bytes and does not read a single key.
	//
	// This field replaced `NotifyOwnerOnBooking bool`. The comment on that one claimed the host
	// "neither sends it nor knows what booking notify means" while the field name — and a column
	// on the kernel's roles table — said the opposite. A capability's settings now travel as the
	// capability's own JSON, and only to that capability.
	CapConfig json.RawMessage
}

func (s *SessionContext) meta() map[string]any {
	if s == nil {
		return map[string]any{}
	}
	return map[string]any{"standmeet/session": map[string]any{
		"owner_id": s.OwnerID,
		// subject_kind / subject_id —— the subject crosses the boundary as a whole
		// pair. **No longer sends `code_id`**: keeping it around would be a second
		// copy of the same fact, and a second copy sooner or later says something
		// different from the first (global CLAUDE.md rule 2).
		"subject_kind":    s.Subject.Kind,
		"subject_id":      s.Subject.ID,
		"conversation_id": s.ConversationID,
		"mode":            s.Mode,
		"visitor_name":    s.VisitorName,
		"visitor_email":   s.VisitorEmail,
		"role_id":         s.RoleID,
		// corpus_scope —— crosses the boundary as a whole blob, fields not split out
		// (see SessionContext.CorpusScope).
		"corpus_scope": s.CorpusScope,
		// capability_config —— this capability's own per-role config, passed through
		// untouched. The host doesn't know any of the keys inside it.
		"capability_config": s.CapConfig,
	}}
}

// CallTool —— calls a tool (default 15s budget). When sctx is non-nil, attaches the
// trusted session context to the request's `_meta`, which the built-in sandbox server
// reads via req.GetMeta().
func (s *Session) CallTool(
	ctx context.Context, name string, args json.RawMessage, sctx *SessionContext,
) (string, error) {
	return s.CallToolWithin(ctx, name, args, sctx, 0)
}

// CallToolWithin —— CallTool with a caller-chosen budget. budget<=0 uses the default callTimeout;
// LLM-backed tools (summarize) pass LongCallTimeout so a legitimately slow generation isn't cut off
// mid-flight (F-A-6).
func (s *Session) CallToolWithin(
	ctx context.Context, name string, args json.RawMessage, sctx *SessionContext,
	budget time.Duration,
) (string, error) {
	out, err := s.CallToolChecked(ctx, name, args, sctx, budget)
	return out.Text, err
}

// ToolOutcome —— a tool call's result WITH its error status. CallToolWithin flattens this to a
// string (an error result arrives text-prefixed "[error] "), which is fine for the visitor loop
// where the model reads prose. A caller that must decide programmatically -- e.g. the owner-MCP
// facade, which has to answer isError to the owner's client rather than dress a failure up as a
// successful payload -- needs the flag itself, not a prefix to sniff for.
type ToolOutcome struct {
	Text    string
	IsError bool
}

// CallToolChecked —— CallToolWithin, but returning the tool's error status alongside its text.
func (s *Session) CallToolChecked(
	ctx context.Context, name string, args json.RawMessage, sctx *SessionContext,
	budget time.Duration,
) (ToolOutcome, error) {
	if budget <= 0 {
		budget = callTimeout
	}
	cctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	req, perr := buildCallToolRequest(name, args, sctx.meta())
	if perr != nil {
		return ToolOutcome{}, perr
	}
	res, err := s.c.CallTool(cctx, req)
	if err != nil {
		return ToolOutcome{}, fmt.Errorf("call tool %s: %w", name, err)
	}
	return ToolOutcome{Text: extractText(res), IsError: res.IsError}, nil
}

// buildCallToolRequest —— flattens the args JSON object into the map[string]any mcp-go
// expects (the mcp-go API is already typed; this step is the transport boundary having
// to marshal into the any-shape it needs). meta non-empty → attach `_meta`.
func buildCallToolRequest(
	name string, args json.RawMessage, meta map[string]any,
) (mcpgo.CallToolRequest, error) {
	req := mcpgo.CallToolRequest{}
	req.Params.Name = name
	parsed, perr := parseArgsAsMap(args)
	if perr != nil {
		return mcpgo.CallToolRequest{}, fmt.Errorf("call tool %s args: %w", name, perr)
	}
	req.Params.Arguments = parsed
	if len(meta) > 0 {
		req.Params.Meta = mcpgo.NewMetaFromMap(meta)
	}
	return req, nil
}

func parseArgsAsMap(args json.RawMessage) (map[string]json.RawMessage, error) {
	if len(args) == 0 {
		return map[string]json.RawMessage{}, nil
	}
	out := map[string]json.RawMessage{}
	if err := json.Unmarshal(args, &out); err != nil {
		return nil, fmt.Errorf("decode args: %w", err)
	}
	return out, nil
}

func translateTool(t *mcpgo.Tool) Tool {
	schemaBytes, err := json.Marshal(t.InputSchema)
	if err != nil {
		schemaBytes = []byte(`{"type":"object","properties":{}}`)
	}
	return Tool{
		Name: t.Name, Description: t.Description, InputSchema: schemaBytes,
		Meta:     toolMeta(t),
		ReadOnly: t.Annotations.ReadOnlyHint != nil && *t.Annotations.ReadOnlyHint,
	}
}

// toolMeta —— passes through a tool's custom `_meta` fields; an empty map if the server
// didn't provide any (the container never returns nil).
func toolMeta(t *mcpgo.Tool) map[string]any {
	if t.Meta == nil || len(t.Meta.AdditionalFields) == 0 {
		return map[string]any{}
	}
	return t.Meta.AdditionalFields
}

// extractText —— concatenates the TextContent entries in CallToolResult.Content.
// isError → prefixes "[error] " so the LLM can see it clearly.
func extractText(res *mcpgo.CallToolResult) string {
	var b strings.Builder
	if res.IsError {
		_, _ = b.WriteString("[error] ")
	}
	for i := range res.Content {
		if tc, ok := res.Content[i].(mcpgo.TextContent); ok {
			_, _ = b.WriteString(tc.Text)
		}
	}
	return b.String()
}
