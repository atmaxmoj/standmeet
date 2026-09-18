// diag_session_tool.go — POST /internal/diag/session/tool
//
// Runs ONE granted tool in a visitor session and returns its raw result. e2e that must
// observe a single tool's output — the isolation-adversary proofs, where each tool
// attempts one escape and reports whether it was blocked — need the tool's own JSON, not
// a chat turn's rendered reply. It assembles the same visitor toolset as /diag/session
// (so a tool the session was not granted is simply absent → 404), finds the named tool,
// and invokes it through the identical sandbox path the agent loop uses.
//
// Faces declare and delegate (check-routes-cyclo): the handler parses + calls, and every
// branch lives in a named helper — the find split mirrors public/tools.go's
// findBindingTool / findToolInBinding.

package sys

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// errToolNotInSession — the session's assembled toolset has no such tool (not granted, or
// no such block). A 404, not a 500: it is a wrong address, not a broken instance.
var errToolNotInSession = errors.New("tool not in session")

type diagToolReq struct {
	Tool string          `json:"tool"`
	Args json.RawMessage `json:"args"`
}

type diagToolResp struct {
	Result string `json:"result"`
}

// diagToolCall — a parsed request: the session token (header) + the body. One struct so
// parseDiagToolReq returns (call, ok) within the two-result limit.
type diagToolCall struct {
	token string
	req   diagToolReq
}

func diagSessionToolHandler(deps DiagSessionDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		call, ok := parseDiagToolReq(w, r)
		if !ok {
			return
		}
		data, err := deps.Sessions.Get(r.Context(), call.token)
		if err != nil {
			writeSessionLookupErr(w, err)
			return
		}
		// assembleInputFor (diag_session.go) bridges to AssembleInput, so this file needs
		// no access/facade import — the domain reach stays in the baselined sibling.
		out, rerr := runSessionTool(r.Context(), deps.Registry,
			assembleInputFor(&data), call.req.Tool, call.req.Args)
		writeToolResult(w, deps, out, rerr)
	}
}

// parseDiagToolReq — the session-token header + JSON body, writing its own 400s. Returns
// ok=false (having already responded) when either is missing/invalid, so the handler is
// left with a declaration and a call.
func parseDiagToolReq(w http.ResponseWriter, r *http.Request) (diagToolCall, bool) {
	token := r.Header.Get("X-Session-Token")
	if token == "" {
		http.Error(w, "missing X-Session-Token", http.StatusBadRequest)
		return diagToolCall{}, false
	}
	var req diagToolReq
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return diagToolCall{}, false
	}
	return diagToolCall{req: req, token: token}, true
}

func writeToolResult(w http.ResponseWriter, deps DiagSessionDeps, out string, rerr error) {
	if rerr != nil {
		writeToolRunErr(w, rerr)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if eerr := json.NewEncoder(w).Encode(&diagToolResp{Result: out}); eerr != nil {
		deps.Log.Error("diag-session-tool encode", "err", eerr)
	}
}

// writeToolRunErr — maps a run error to its status: an unknown tool is a 404 (wrong
// address), anything else a 500 (broken instance).
func writeToolRunErr(w http.ResponseWriter, rerr error) {
	if errors.Is(rerr, errToolNotInSession) {
		http.Error(w, "tool not in session", http.StatusNotFound)
		return
	}
	http.Error(w, "internal: "+rerr.Error(), http.StatusInternalServerError)
}

// runSessionTool — assemble the visitor toolset, find the named tool, invoke it. Every
// binding's Close hook is released afterward whether or not it held the target tool.
func runSessionTool(
	ctx context.Context, reg *registry.Registry,
	in *registry.AssembleInput, toolName string, args json.RawMessage,
) (string, error) {
	bindings := reg.AssembleVisitor(ctx, in)
	defer closeBindings(bindings)
	return findAndInvoke(ctx, bindings, toolName, args)
}

func findAndInvoke(
	ctx context.Context, bindings []*registry.Binding, toolName string, args json.RawMessage,
) (string, error) {
	tool, ok := findBindingTool(bindings, toolName)
	if !ok {
		return "", errToolNotInSession
	}
	// argsOrEmpty (diag_supplier.go) normalizes an empty body to "{}"; InvokableRun wants a string.
	return tool.Tool.InvokableRun(ctx, string(argsOrEmpty(args)))
}

// findBindingTool / findToolInBinding — the outer loop over bindings, the inner over one
// binding's tools; split so each stays declarative (mirrors public/tools.go).
func findBindingTool(bindings []*registry.Binding, name string) (*registry.BindingTool, bool) {
	for _, b := range bindings {
		if t, ok := findToolInBinding(b, name); ok {
			return t, true
		}
	}
	return nil, false
}

func findToolInBinding(b *registry.Binding, name string) (*registry.BindingTool, bool) {
	for i := range b.Tools {
		if b.Tools[i].Name == name {
			return &b.Tools[i], true
		}
	}
	return nil, false
}

func closeBindings(bindings []*registry.Binding) {
	for _, b := range bindings {
		if b.Close != nil {
			b.Close()
		}
	}
}
