// mcp_visitor.go —— the MCP face on the visitor side: someone holding a code points
// their own AI client (Claude Desktop / Cursor / …) at this instance and asks directly,
// using the tools that code grants.
//
// Why: the owner already has an MCP face (`/mcp`, Sigv1-signed), but outward-facing
// there were only two paths — web chat, and an API key for programs. "Someone with a
// code asking with their own AI" had no face; a recruiter with an AI client open could
// only go chat on the web page.
//
// Shape: follows the same invariant as microsites — this is one more rendering of the
// same code. Same authorization, role, quota, billing; no "MCP-only" admission logic —
// auth is swapped for the code, and assembly/execution run through the same path as the
// visitor tools (tools.go's AssembleVisitorForTool → InvokableRun). Deny/quota/
// revocation take effect here automatically the same way.
//
// Why the code itself, not a session token: an MCP client's config holds one static
// string — it can't do "open a session, then get a token". The code is already the
// product's ticket (QR code, corner of a résumé), so this face uses the same ticket as
// every other face.

package public

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// visitorMCPPath —— the mount point. The owner's face is `/mcp`; this is its outward twin.
const visitorMCPPath = "/mcp/visitor"

// visitorNameHeader —— optional self-reported name. The web path pops a "who are you"
// modal; MCP has no UI, so a header stands in — omitting it means anonymous, same as skip.
const visitorNameHeader = "X-Standmeet-Visitor"

type visitorMCPKey struct{}

// visitorMCPSession —— the visitor session behind one MCP connection. Stores the
// already-assembled input, not the raw session row: this face doesn't need to know the
// session shape, it just hands input to capability assembly — one less domain type
// crossing in, one less place to change when the domain does.
type visitorMCPSession struct {
	In     *capreg.AssembleInput
	ConvID string
}

// MountVisitorMCP —— wires up the visitor MCP face at `/mcp/visitor`.
//
// toolNames comes from the assembly layer (same manifest as the api face, living in
// paritymanifest) — this face only declares it needs a list, never looks one up itself.
func (h *Handlers) MountVisitorMCP(toolNames []string) http.Handler {
	srv := server.NewMCPServer(
		"standmeet-visitor", "0.1.0",
		server.WithToolCapabilities(true),
		// Tool table is filtered per code (register-all + per-session filter is the
		// mcp-go pattern). Without filtering, tools/list would advertise tools this
		// code can't call — lying to the visitor's AI, which would plan a dead path.
		server.WithToolFilter(h.filterVisitorTools),
	)
	h.registerVisitorTools(srv, toolNames)
	httpSrv := server.NewStreamableHTTPServer(
		srv,
		server.WithHTTPContextFunc(carryVisitorSession),
		server.WithEndpointPath(visitorMCPPath),
	)
	return h.visitorMCPAuth(httpSrv)
}

// visitorMCPAuth —— `Authorization: Bearer <code>` → opens a session.
//
// One session per connection, so quota/membership/transcripts land in the same place
// as the web path, and /admin/conversations shows which code it came from.
func (h *Handlers) visitorMCPAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess, refusal := h.openVisitorMCP(r)
		if sess == nil {
			h.writeVisitorMCPErr(w, r, refusal.Status, refusal.Message)
			return
		}
		ctx := context.WithValue(r.Context(), visitorMCPKey{}, sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// openVisitorMCP —— whether this connection gets in. On refusal, returns the message
// meant for the other side, not just a status code: the client has no UI, so this
// message is all it will ever get.
//
// The real code-for-session exchange lives in sessions.go (`OpenCodeSession`), where
// every "trade a code for a session" goes. This face only owns the MCP half: read the
// header, stuff the outcome into ctx.
func (h *Handlers) openVisitorMCP(r *http.Request) (*visitorMCPSession, apierr.Envelope) {
	code, refusal := h.visitorMCPCredential(r)
	if code == "" {
		return nil, refusal
	}
	return h.visitorMCPSessionFor(r, code)
}

// visitorMCPCredential —— whether this request carries a ticket valid right now. An
// empty string means no ticket, or the gate blocked it.
func (h *Handlers) visitorMCPCredential(r *http.Request) (string, apierr.Envelope) {
	code := bearerCode(r.Header.Get("Authorization"))
	if code == "" {
		return "", apierr.Envelope{
			Status:  http.StatusUnauthorized,
			Code:    "code_missing",
			Message: "present your access code as `Authorization: Bearer <code>`",
		}
	}
	// The code-guessing gate covers this face too — a new entry point must never
	// reopen a closed hole. On the web path the same IP gets locked out for 15min
	// after repeated wrong codes; without this gate an attacker could switch
	// endpoints and enumerate unrated ([[gate-after-early-return-is-walkable]]).
	if h.CodeGuard.Locked(r.Context(), clientIP(r), "") {
		return "", apierr.Envelope{
			Status:  http.StatusTooManyRequests,
			Code:    "code_locked",
			Message: "too many failed codes from this address — try again later",
		}
	}
	return code, apierr.Envelope{}
}

func (h *Handlers) visitorMCPSessionFor(
	r *http.Request, code string,
) (*visitorMCPSession, apierr.Envelope) {
	opened, env := h.OpenCodeSession(
		r.Context(), code, r.Header.Get(visitorNameHeader), clientIP(r),
	)
	if opened.In == nil {
		return nil, env
	}
	return &visitorMCPSession{In: opened.In, ConvID: opened.ConvID}, apierr.Envelope{}
}

func bearerCode(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

// carryVisitorSession —— carries the session from the request ctx into the mcp ctx, so
// tool handler functions can read it.
func carryVisitorSession(ctx context.Context, r *http.Request) context.Context {
	s, ok := r.Context().Value(visitorMCPKey{}).(*visitorMCPSession)
	if !ok {
		return ctx
	}
	return context.WithValue(ctx, visitorMCPKey{}, s)
}

func visitorMCPFrom(ctx context.Context) *visitorMCPSession {
	s, ok := ctx.Value(visitorMCPKey{}).(*visitorMCPSession)
	if !ok {
		return nil
	}
	return s
}

// registerVisitorTools —— registers **the outward-facing set** of tools. Same source
// as the api face, so the two outward faces never drift and report different things.
func (h *Handlers) registerVisitorTools(srv *server.MCPServer, names []string) {
	for _, name := range names {
		srv.AddTool(
			mcpgo.NewToolWithRawSchema(name, visitorToolDesc(name), visitorToolSchema()),
			h.runVisitorTool(name),
		)
	}
}

// visitorToolSchema —— the input shape is owned by the capability itself; this layer
// never restates it (a second source of truth). Real validation lives with the tool.
func visitorToolSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","additionalProperties":true}`)
}

func visitorToolDesc(name string) string {
	return name + " — scoped to the access code you presented."
}

// filterVisitorTools —— reports only the tools **this code can actually call**.
func (h *Handlers) filterVisitorTools(ctx context.Context, tools []mcpgo.Tool) []mcpgo.Tool {
	s := visitorMCPFrom(ctx)
	if s == nil {
		// An empty table, never nil — no session means zero tools, an explicit answer.
		return []mcpgo.Tool{}
	}
	return keepNamed(tools, h.visitorGrantedNames(ctx, s))
}

// visitorGrantedNames —— which tools this code can actually call right now.
func (h *Handlers) visitorGrantedNames(
	ctx context.Context, s *visitorMCPSession,
) map[string]bool {
	in := s.In
	live := make(map[string]bool)
	for _, spec := range h.Visitor.AgentSkills.AssembleVisitorBundle(ctx, in).ToolSpecs {
		live[spec.Name] = true
	}
	return live
}

func keepNamed(tools []mcpgo.Tool, live map[string]bool) []mcpgo.Tool {
	out := make([]mcpgo.Tool, 0, len(tools))
	for i := range tools {
		if live[tools[i].Name] {
			out = append(out, tools[i])
		}
	}
	return out
}

// runVisitorTool —— executes one call, through the same visitor-tool path
// (AssembleVisitorForTool → InvokableRun), so deny/quota/revocation take effect as before.
func (h *Handlers) runVisitorTool(name string) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		s := visitorMCPFrom(ctx)
		if s == nil {
			return mcpgo.NewToolResultError("no session on this connection"), nil
		}
		in := s.In
		bindings := h.Visitor.AgentSkills.AssembleVisitorForTool(ctx, in, name)
		defer closeBindings(bindings)
		tool, found := findBindingTool(bindings, name)
		if !found {
			// "this code doesn't grant this tool" and "this tool is broken" are two
			// different things — say which one clearly.
			return mcpgo.NewToolResultError(
				"this access code does not grant " + name,
			), nil
		}
		return runVisitorToolCall(ctx, tool, &req), nil
	}
}

// runVisitorToolCall —— the result of one call. A tool's own failure is a "result", not
// a transport error: throwing it as transport error in MCP would make the client think
// the connection broke, when really just this call was refused (quota/admission/bad args).
func runVisitorToolCall(
	ctx context.Context, tool *capreg.BindingTool, req *mcpgo.CallToolRequest,
) *mcpgo.CallToolResult {
	body, merr := json.Marshal(req.GetArguments())
	if merr != nil {
		return mcpgo.NewToolResultError("bad arguments: " + merr.Error())
	}
	out, execErr := tool.Tool.InvokableRun(ctx, string(body))
	if execErr != nil {
		return mcpgo.NewToolResultError(execErr.Error())
	}
	return mcpgo.NewToolResultText(out)
}

// writeVisitorMCPErr —— refuses this connection, answering at the layer the other side
// actually listens on.
//
// This used to be 401 + `WWW-Authenticate` (correct per RFC 6750), but in MCP a 401
// means "go do OAuth" (spec ties auth to OAuth 2.1 + protected-resource metadata): a
// compliant client runs discovery instead. The official Inspector printed `Interactive
// OAuth requires a TTY`, and our "bring your access code" message never showed (F-P-8)
// — message-in-body isn't enough when nobody looks at the body.
//
// A 401 path is for an OAuth server, which we aren't, so this returns a JSON-RPC error
// instead — what the client actually renders. id is echoed from the request: a client
// matching responses by id treats `id:null` as unmatched and hangs.
//
// Cost: an auth failure now looks like a 200 in the access log. Tell it apart via the
// JSON-RPC error.code, or the code-guessing gate's own counter.
func (h *Handlers) writeVisitorMCPErr(
	w http.ResponseWriter, r *http.Request, status int, msg string,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := visitorMCPRefusal(requestID(r), status, msg)
	if eerr := json.NewEncoder(w).Encode(resp); eerr != nil {
		h.Log.Error("encode visitor mcp refusal", "err", eerr)
	}
}

// visitorMCPErrCode —— inside JSON-RPC's implementation-defined range (-32000..-32099).
const visitorMCPErrCode = -32001

// visitorMCPIDProbeMax —— cap on reading just to find an id. This path already decided
// to refuse; it shouldn't read an arbitrarily large body into memory to do it.
const visitorMCPIDProbeMax = 64 << 10

type visitorMCPErrData struct {
	HTTPStatus int `json:"http_status"`
}

type visitorMCPErrDetail struct {
	// Message is the sentence meant to be read by a person.
	Message string `json:"message"`
	// Data.HTTPStatus —— the kind of refusal (401 wrong ticket / 429 gate-blocked).
	// Merged into one message, the two cases' next steps become indistinguishable.
	Data visitorMCPErrData `json:"data"`
	Code int               `json:"code"`
}

type visitorMCPErrBody struct {
	JSONRPC string              `json:"jsonrpc"`
	ID      json.RawMessage     `json:"id"`
	Error   visitorMCPErrDetail `json:"error"`
}

func visitorMCPRefusal(id json.RawMessage, status int, msg string) visitorMCPErrBody {
	return visitorMCPErrBody{
		JSONRPC: "2.0", ID: id,
		Error: visitorMCPErrDetail{
			Code: visitorMCPErrCode, Message: msg,
			Data: visitorMCPErrData{HTTPStatus: status},
		},
	}
}

// requestID —— echoes back the request's id. A client matching by id treats `id:null`
// as unmatched and hangs — worse than an ugly error. Falls back to null only if unreadable.
func requestID(r *http.Request) json.RawMessage {
	raw, err := io.ReadAll(io.LimitReader(r.Body, visitorMCPIDProbeMax))
	if err != nil {
		return jsonNull
	}
	return idFromBody(raw)
}

var jsonNull = json.RawMessage("null")

func idFromBody(raw []byte) json.RawMessage {
	var probe struct {
		ID json.RawMessage `json:"id"`
	}
	if uerr := json.Unmarshal(raw, &probe); uerr != nil {
		return jsonNull
	}
	if len(probe.ID) == 0 {
		return jsonNull
	}
	return probe.ID
}
