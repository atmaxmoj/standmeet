// app_state.go —— MCP App 跨刷新状态 endpoint（访客 session 视角）。
//
// 沙箱卡（ui://）经 host 对**自己 mcp 那一格**增删改查。mcp_id 由后端从 {tool} 派生
// （capreg binding 的 capability id，如 calendar.book / corpus.retrieval）—— 绝不收客户端
// 传来的 mcp_id，这是隔离的根：卡碰不到别的 mcp 那格。member（session 背后的耐久身份）
// 是 scope；public/byoai 无 member → 无处可存。tool 未授权 → 404（与 tool 派发同口径）。
//
//	GET    /sessions/{id}/app-state/{tool}        → {state:{key:value}}
//	PUT    /sessions/{id}/app-state/{tool}/{key}  {value} → {ok:true}
//	DELETE /sessions/{id}/app-state/{tool}/{key}  → {ok:true}

package public

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcpdomain"
	"github.com/atmaxmoj/standmeet/internal/session"
)

// AppStateStore —— mcp_app_state 持久层（route 注入；wireup 接 postgres repo）。
type AppStateStore interface {
	Set(ctx context.Context, ref mcpdomain.AppStateRef, value []byte) error
	Get(ctx context.Context, memberID, mcpID string) (map[string]json.RawMessage, error)
	Delete(ctx context.Context, memberID, mcpID, key string) error
}

// appStateResp / appStateAck / appStateErr —— 定型 JSON 响应（business code 禁 any）。
type appStateResp struct {
	State map[string]json.RawMessage `json:"state"`
}
type appStateAck struct {
	OK bool `json:"ok"`
}
type appStateErr struct {
	Reason string `json:"reason"`
	OK     bool   `json:"ok"`
}

// appScope —— 一次 app-state 请求解出的 (member, owner, mcp_id)。
type appScope struct {
	memberID string
	ownerID  string
	mcpID    string
}

func (h *Handlers) getAppState() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sc, ok := h.resolveAppScope(w, r)
		if !ok {
			return
		}
		state, err := h.AppState.Get(r.Context(), sc.memberID, sc.mcpID)
		if err != nil {
			h.Log.Error("app-state get", logErrKey, err)
			writeAppStateErr(h.Log, w, http.StatusInternalServerError, "load_failed")
			return
		}
		writeAppStateState(h.Log, w, state)
	}
}

func (h *Handlers) setAppState() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if sc, ok := h.resolveAppScope(w, r); ok {
			h.doSetAppState(w, r, sc)
		}
	}
}

func (h *Handlers) doSetAppState(w http.ResponseWriter, r *http.Request, sc appScope) {
	value, ok := readAppStateValue(h.Log, w, r)
	if !ok {
		return
	}
	ref := mcpdomain.AppStateRef{
		OwnerID: sc.ownerID, MemberID: sc.memberID,
		McpID: sc.mcpID, Key: chi.URLParam(r, "key"),
	}
	if err := h.AppState.Set(r.Context(), ref, value); err != nil {
		h.Log.Error("app-state set", logErrKey, err)
		writeAppStateErr(h.Log, w, http.StatusInternalServerError, "save_failed")
		return
	}
	writeAppStateAck(h.Log, w)
}

func (h *Handlers) deleteAppState() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sc, ok := h.resolveAppScope(w, r)
		if !ok {
			return
		}
		key := chi.URLParam(r, "key")
		if err := h.AppState.Delete(r.Context(), sc.memberID, sc.mcpID, key); err != nil {
			h.Log.Error("app-state delete", logErrKey, err)
			writeAppStateErr(h.Log, w, http.StatusInternalServerError, "delete_failed")
			return
		}
		writeAppStateAck(h.Log, w)
	}
}

// resolveAppScope —— auth → 装配 → 从 tool 派生 mcp_id + ACL（tool 必须在装配出的
// binding 里 = 已授权）。member 空（无耐久身份）→ 403，state 无处可挂。
func (h *Handlers) resolveAppScope(w http.ResponseWriter, r *http.Request) (appScope, bool) {
	auth, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return appScope{}, false
	}
	if auth.Data.MemberID == "" {
		writeAppStateErr(h.Log, w, http.StatusForbidden, "no_durable_identity")
		return appScope{}, false
	}
	return h.scopeForTool(w, r, auth.Data)
}

// scopeForTool —— 装配访客 bindings → 从 {tool} 派生 mcp_id + ACL（tool 须已授权）。
func (h *Handlers) scopeForTool(
	w http.ResponseWriter, r *http.Request, data *session.VisitorSessionData,
) (appScope, bool) {
	in := assembleInputFromSession(data, chi.URLParam(r, "id"))
	bindings := h.Visitor.AgentSkills.AssembleVisitor(r.Context(), in)
	defer closeBindings(bindings)
	mcpID, found := bindingMCPForTool(bindings, chi.URLParam(r, "tool"))
	if !found {
		writeAppStateErr(h.Log, w, http.StatusNotFound, "tool_not_enabled")
		return appScope{}, false
	}
	return appScope{memberID: data.MemberID, ownerID: data.OwnerID, mcpID: mcpID}, true
}

// bindingMCPForTool —— tool → 它所属 binding 的 capability id（= mcp_id）。同一 mcp 的
// 多个 tool（calendar_book / calendar_list_slots）映到同一 id → 共享一格。
func bindingMCPForTool(bindings []*capreg.Binding, tool string) (string, bool) {
	for _, b := range bindings {
		if id, ok := toolMCPInBinding(b, tool); ok {
			return id, true
		}
	}
	return "", false
}

func toolMCPInBinding(b *capreg.Binding, tool string) (string, bool) {
	for i := range b.Tools {
		if b.Tools[i].Name == tool {
			return b.State.ID, true
		}
	}
	return "", false
}

// readAppStateValue —— 取 body 的 {value:<json>}；缺失/畸形 → 400。value 当 opaque 存。
func readAppStateValue(log *slog.Logger, w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeAppStateErr(log, w, http.StatusBadRequest, "invalid_body")
		return []byte{}, false
	}
	value := decodeAppStateValue(body)
	if len(value) == 0 {
		writeAppStateErr(log, w, http.StatusBadRequest, "missing_value")
		return []byte{}, false
	}
	return value, true
}

func decodeAppStateValue(body []byte) json.RawMessage {
	var wrap struct {
		Value json.RawMessage `json:"value"`
	}
	if json.Unmarshal(body, &wrap) != nil {
		return json.RawMessage{}
	}
	return wrap.Value
}

func writeAppStateState(log *slog.Logger, w http.ResponseWriter, state map[string]json.RawMessage) {
	if state == nil {
		state = map[string]json.RawMessage{}
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(appStateResp{State: state}); err != nil {
		log.Error("app-state encode", logErrKey, err)
	}
}

func writeAppStateAck(log *slog.Logger, w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(appStateAck{OK: true}); err != nil {
		log.Error("app-state encode ack", logErrKey, err)
	}
}

func writeAppStateErr(log *slog.Logger, w http.ResponseWriter, status int, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(appStateErr{Reason: reason}); err != nil {
		log.Error("app-state encode err", logErrKey, err)
	}
}
