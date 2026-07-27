// tools.go —— Phase D-3: per-tool dispatch HTTP 端点。
//
// URL: POST /api/v1/sessions/{conv_id}/tools/{tool_name}
// Auth: Bearer visitor session token (跟 /messages 共用)
// Body: raw JSON tool args (透传到 capability binding 的 Execute)
//
// Behavior:
//   1. 鉴权 → 拿 session data
//   2. 走 Registry.AssembleVisitor 装配 binding (跟 chat path 同源 gating)
//   3. 按 tool name 查 binding；找不到 → 404 capability_not_enabled
//   4. 执行 tool；返 {ok:true, result, capability_state} 或 tool error
//      envelope；capability_state 必返让前端 zustand 同步 (quota cascade
//      场景：tool 跑完 quota 耗尽，前端要立刻看到 enabled=false)
//
// 跟 chat path 共用 capability 装配代码 → 行为一致；前端 pi-agent-core
// 的 ToolDispatcher port 实现就是 fetch 此端点。

package public

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// methodQuery —— HTTP QUERY (RFC 10008)：安全/幂等的带 body 查询。只读工具可经此调用。
// chi 默认方法表不含 QUERY，composition root（server.go）启动时 chi.RegisterMethod 注册。
const methodQuery = "QUERY"

// isQueryOnMutating —— QUERY 打到一个会改状态（非只读）的工具 → 拒（405）。QUERY 语义
// 承诺安全/幂等，会改状态的工具只能走 POST。
func isQueryOnMutating(method string, t *capreg.BindingTool) bool {
	return method == methodQuery && !t.ReadOnly
}

// toolDispatch handler —— 单一入口处理任意 per-tool 调用（POST 全工具；QUERY 仅只读工具）。
func (h *Handlers) toolDispatch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		body, berr := io.ReadAll(r.Body)
		if berr != nil {
			h.Log.Warn("tool dispatch read body", "err", berr)
			writeToolErr(h.Log, w, toolErr{
				Status: http.StatusBadRequest, Reason: "invalid_body",
				Detail: "invalid request body",
			})
			return
		}
		toolName := chi.URLParam(r, "tool_name")
		convID := chi.URLParam(r, "id")
		runToolDispatch(r.Context(), h, w, &toolDispatchArgs{
			Data: auth.Data, ToolName: toolName,
			ConvID: convID, Body: body, Method: r.Method,
		})
	}
}

type toolDispatchArgs struct {
	Data     *access.VisitorSessionData
	ToolName string
	ConvID   string
	Method   string
	Body     []byte
}

// runToolDispatch —— 拆出装配 + 派发 + response 流，让 handler cyclo ≤ 3。
func runToolDispatch(
	ctx context.Context, h *Handlers, w http.ResponseWriter, args *toolDispatchArgs,
) {
	in := assembleInputFromSession(args.Data, args.ConvID)
	bindings := h.Visitor.AgentSkills.AssembleVisitor(ctx, in)
	defer closeBindings(bindings)
	tool, found := findBindingTool(bindings, args.ToolName)
	if !found {
		writeToolErr(h.Log, w, toolErr{
			Status: http.StatusNotFound, Reason: "capability_not_enabled",
			Detail:   "tool not exposed in this session",
			CapState: h.Visitor.AgentSkills.VisitorStates(ctx, in),
		})
		return
	}
	if isQueryOnMutating(args.Method, tool) {
		writeToolErr(h.Log, w, toolErr{
			Status: http.StatusMethodNotAllowed, Reason: "method_not_allowed",
			Detail:   "QUERY is only for read-only tools; use POST",
			CapState: h.Visitor.AgentSkills.VisitorStates(ctx, in),
		})
		return
	}
	executeAndRespond(ctx, h, w, executeArgs{
		In: in, ToolName: args.ToolName, Body: args.Body, Tool: tool,
	})
}

type executeArgs struct {
	In       *capreg.AssembleInput
	Tool     *capreg.BindingTool
	ToolName string
	Body     []byte
}

func executeAndRespond(
	ctx context.Context, h *Handlers, w http.ResponseWriter, args executeArgs,
) {
	out, execErr := args.Tool.Tool.InvokableRun(ctx, string(args.Body))
	capState := h.Visitor.AgentSkills.VisitorStates(ctx, args.In)
	if execErr != nil {
		// Raw executor error → log (ops); client sees a static detail so no
		// executor/provider internals leak into the visitor's browser.
		h.Log.Warn("tool dispatch exec", "tool", args.ToolName, "err", execErr)
		writeToolErr(h.Log, w, toolErr{
			Status: http.StatusInternalServerError, Reason: "tool_error",
			Detail: "tool execution failed", CapState: capState,
		})
		return
	}
	writeToolOK(h.Log, w, out, capState)
}

// findBindingTool —— walk bindings 找 name 匹配的 tool。同名只取第一个
// (capability 注册顺序里没有跟 name 撞的设计前提)。
func findBindingTool(
	bindings []*capreg.Binding, name string,
) (*capreg.BindingTool, bool) {
	for _, b := range bindings {
		if t, ok := findToolInBinding(b, name); ok {
			return t, true
		}
	}
	return nil, false
}

func findToolInBinding(
	b *capreg.Binding, name string,
) (*capreg.BindingTool, bool) {
	for i := range b.Tools {
		if b.Tools[i].Name == name {
			return &b.Tools[i], true
		}
	}
	return nil, false
}

// closeBindings —— 释放装配产生的 binding 资源 (ext-mcp session 等)。
// 跟 chat path 的 close pattern 一致；defer 在 handler 顶部一次。
func closeBindings(bindings []*capreg.Binding) {
	for _, b := range bindings {
		if b.Close != nil {
			b.Close()
		}
	}
}

type toolOKResp struct {
	Result          json.RawMessage          `json:"result"`
	CapabilityState []capreg.CapabilityState `json:"capability_state"`
	OK              bool                     `json:"ok"`
}

type toolErrResp struct {
	Reason          string                   `json:"reason"`
	Detail          string                   `json:"detail,omitempty"`
	CapabilityState []capreg.CapabilityState `json:"capability_state,omitempty"`
	OK              bool                     `json:"ok"`
}

func writeToolOK(
	log *slog.Logger, w http.ResponseWriter,
	executorOut string, capState []capreg.CapabilityState,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := toolOKResp{
		OK: true, Result: rawOrQuoted(executorOut), CapabilityState: capState,
	}
	if err := json.NewEncoder(w).Encode(&resp); err != nil {
		log.Error("tool dispatch encode ok", "err", err)
	}
}

type toolErr struct {
	Reason   string
	Detail   string
	CapState []capreg.CapabilityState
	Status   int
}

func writeToolErr(
	log *slog.Logger, w http.ResponseWriter, e toolErr,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.Status)
	resp := toolErrResp{
		OK: false, Reason: e.Reason, Detail: e.Detail, CapabilityState: e.CapState,
	}
	if err := json.NewEncoder(w).Encode(&resp); err != nil {
		log.Error("tool dispatch encode err", "err", err)
	}
}

// rawOrQuoted —— executor 通常返 JSON string；非 JSON 时包成 JSON string。
func rawOrQuoted(s string) json.RawMessage {
	if json.Valid([]byte(s)) {
		return json.RawMessage(s)
	}
	quoted, err := json.Marshal(s)
	if err != nil {
		return json.RawMessage(`null`)
	}
	return quoted
}
