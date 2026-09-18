// diag_session_tool.go — POST /internal/diag/session/tool
//
// Runs ONE granted tool in a visitor session and returns its raw result. e2e that must
// observe a single tool's output — the isolation-adversary proofs, where each tool
// attempts one escape and reports whether it was blocked — need the tool's own JSON, not
// a chat turn's rendered reply. It assembles the same visitor toolset as /diag/session
// (so a tool the session was not granted is simply absent → 404), finds the named tool,
// and invokes it through the identical sandbox path the agent loop uses.

package sys

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
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

func diagSessionToolHandler(deps DiagSessionDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Session-Token")
		if token == "" {
			http.Error(w, "missing X-Session-Token", http.StatusBadRequest)
			return
		}
		var req diagToolReq
		if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		data, err := deps.Sessions.Get(r.Context(), token)
		if err != nil {
			writeSessionLookupErr(w, err)
			return
		}
		out, rerr := runSessionTool(r.Context(), deps.Registry, &data, req.Tool, req.Args)
		writeToolResult(w, deps, out, rerr)
	}
}

func writeToolResult(w http.ResponseWriter, deps DiagSessionDeps, out string, rerr error) {
	if rerr != nil {
		if errors.Is(rerr, errToolNotInSession) {
			http.Error(w, "tool not in session", http.StatusNotFound)
			return
		}
		http.Error(w, "internal: "+rerr.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if eerr := json.NewEncoder(w).Encode(&diagToolResp{Result: out}); eerr != nil {
		deps.Log.Error("diag-session-tool encode", "err", eerr)
	}
}

// runSessionTool — assemble the visitor toolset, find the named tool, invoke it. Every
// binding's Close hook is released afterward whether or not it held the target tool.
func runSessionTool(
	ctx context.Context, reg *registry.Registry,
	data *access.VisitorSessionData, toolName string, args json.RawMessage,
) (string, error) {
	bindings := reg.AssembleVisitor(ctx, assembleInputFor(data))
	defer closeBindings(bindings)
	return findAndInvoke(ctx, bindings, toolName, args)
}

func findAndInvoke(
	ctx context.Context, bindings []*registry.Binding, toolName string, args json.RawMessage,
) (string, error) {
	argsJSON := string(args)
	if argsJSON == "" {
		argsJSON = "{}"
	}
	for _, b := range bindings {
		for i := range b.Tools {
			if b.Tools[i].Name == toolName {
				return b.Tools[i].Tool.InvokableRun(ctx, argsJSON)
			}
		}
	}
	return "", errToolNotInSession
}

func closeBindings(bindings []*registry.Binding) {
	for _, b := range bindings {
		if b.Close != nil {
			b.Close()
		}
	}
}
