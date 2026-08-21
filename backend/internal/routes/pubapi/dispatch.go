// dispatch.go —— discovery (GET /tools) + per-tool dispatch (POST/QUERY /tools/{name}). The toolset
// (grant ∩ opened ∩ whitelist) is already frozen into context by the assemble middleware, so these
// handlers stay presentation-only. Not-granted / not-opened / not-whitelisted are indistinguishable
// (all "capability_not_enabled") so the gate that failed never leaks.

package pubapi

import (
	"context"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
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
		h.writeMissingTool(w, r, chi.URLParam(r, "name"))
		return
	}
	if queryOnMutating(r.Method, tool) {
		h.writeErr(w, http.StatusMethodNotAllowed, "method_not_allowed",
			"QUERY is only for read-only tools; use POST")
		return
	}
	h.runTool(w, r, keyFromCtx(r.Context()), tool)
}

// writeMissingTool —— the tool is not in this key's set. Which gate dropped it stays hidden — with
// **one** exception: a spent usage quota is answered as itself.
//
// Why that one is different in kind. Every other gate (not granted, not opened, not whitelisted)
// answers a question the caller has no business asking, and telling them would map out the owner's
// configuration. A quota is the caller's own consumption: they already know how many calls they
// made, so naming it leaks nothing — while withholding it leaves a well-behaved client retrying a
// call that cannot succeed until the owner acts. 429 (with the same shape as the rate limiter) says
// "later, maybe"; 404 said "never", and that was false (F-B-11).
func (h *Handlers) writeMissingTool(w http.ResponseWriter, r *http.Request, name string) {
	if h.quotaSpent(r, name) {
		h.writeErr(w, http.StatusTooManyRequests, "quota_exhausted",
			"this key has used its allowance for that capability — "+
				"the owner sets it on the key")
		return
	}
	h.writeErr(w, http.StatusNotFound, "capability_not_enabled",
		"tool not available to this key")
}

// quotaSpent —— was this tool dropped because the key's allowance is gone? Asked only on a request
// that has already failed, so the extra lookup never touches the hot path.
func (h *Handlers) quotaSpent(r *http.Request, name string) bool {
	ts := toolsetFromCtx(r.Context())
	if ts == nil || ts.Input == nil {
		return false
	}
	return errors.Is(h.d.AgentSkills.HiddenReasonForTool(r.Context(), ts.Input, name),
		capreg.ErrQuotaExhausted)
}

// queryOnMutating —— a QUERY request against a state-changing tool (QUERY is read-only only).
func queryOnMutating(method string, tool *capreg.BindingTool) bool {
	return method == methodQuery && !tool.ReadOnly
}

// runTool —— read the body, execute, respond. Executor errors are logged and returned as a static
// tool_error (no provider internals reach the caller). last_used_at is bumped best-effort.
func (h *Handlers) runTool(
	w http.ResponseWriter, r *http.Request, key *access.APIKey, tool *capreg.BindingTool,
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
