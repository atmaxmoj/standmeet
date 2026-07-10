// dispatch.go —— discovery (GET /tools) + per-tool dispatch (POST/QUERY /tools/{name}). The toolset
// (grant ∩ opened ∩ whitelist) is already frozen into context by the assemble middleware, so these
// handlers stay presentation-only. Not-granted / not-opened / not-whitelisted are indistinguishable
// (all "capability_not_enabled") so the gate that failed never leaks.

package pubapi

import (
	"context"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

// toolView / toolsResp —— discovery response.
type toolView struct {
	Name        string `json:"name"`
	InputSchema string `json:"input_schema,omitempty"`
	ReadOnly    bool   `json:"read_only"`
}

type toolsResp struct {
	Tools []toolView `json:"tools"`
}

// discover —— GET /tools: the tools this key can call right now.
func (h *Handlers) discover(w http.ResponseWriter, r *http.Request) {
	ts := toolsetFromCtx(r.Context())
	out := make([]toolView, 0, len(ts.Tools))
	for _, t := range ts.Tools {
		out = append(out, toolView{
			Name: t.Name, InputSchema: string(t.InputSchema), ReadOnly: t.ReadOnly,
		})
	}
	h.writeJSON(w, http.StatusOK, toolsResp{Tools: out})
}

// dispatch —— POST/QUERY /tools/{name}: run one exposed tool. QUERY is read-only tools only.
func (h *Handlers) dispatch(w http.ResponseWriter, r *http.Request) {
	ts := toolsetFromCtx(r.Context())
	tool := findTool(ts.Tools, chi.URLParam(r, "name"))
	if tool == nil {
		h.writeErr(w, http.StatusNotFound, "capability_not_enabled",
			"tool not available to this key")
		return
	}
	if queryOnMutating(r.Method, tool) {
		h.writeErr(w, http.StatusMethodNotAllowed, "method_not_allowed",
			"QUERY is only for read-only tools; use POST")
		return
	}
	h.runTool(w, r, keyFromCtx(r.Context()), tool)
}

// queryOnMutating —— a QUERY request against a state-changing tool (QUERY is read-only only).
func queryOnMutating(method string, tool *capreg.BindingTool) bool {
	return method == methodQuery && !tool.ReadOnly
}

// runTool —— read the body, execute, respond. Executor errors are logged and returned as a static
// tool_error (no provider internals reach the caller). last_used_at is bumped best-effort.
func (h *Handlers) runTool(
	w http.ResponseWriter, r *http.Request, key *domain.APIKey, tool *capreg.BindingTool,
) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAPIBodyBytes)
	body, berr := io.ReadAll(r.Body)
	if berr != nil {
		h.writeErr(w, http.StatusRequestEntityTooLarge, "body_too_large",
			"request body is malformed or exceeds the size limit")
		return
	}
	out, execErr := tool.Tool.InvokableRun(r.Context(), string(body))
	if execErr != nil {
		h.d.Log.Warn("api tool exec", "tool", tool.Name, "err", execErr)
		h.writeErr(w, http.StatusBadGateway, "tool_error", "the tool failed to run")
		return
	}
	h.bumpLastUsed(r.Context(), key.ID)
	h.writeToolResult(w, out)
}

func (h *Handlers) bumpLastUsed(ctx context.Context, id string) {
	if err := h.d.Keys.TouchLastUsed(ctx, id); err != nil {
		h.d.Log.Warn("api key touch last used", "err", err)
	}
}

func (h *Handlers) writeToolResult(w http.ResponseWriter, out string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte(`{"result":` + out + `}`)); err != nil {
		h.d.Log.Warn("api write tool result", "err", err)
	}
}

func findTool(tools []*capreg.BindingTool, name string) *capreg.BindingTool {
	for _, t := range tools {
		if t.Name == name {
			return t
		}
	}
	return nil
}
