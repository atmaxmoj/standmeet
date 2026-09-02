// app_state.go —— the MCP App cross-refresh state endpoint (from the visitor session's
// point of view).
//
// A sandboxed card (ui://) CRUDs **only its own MCP slot** through the host. mcp_id is
// derived server-side from {tool} (the capability id off the capreg binding, e.g.
// calendar.book / corpus.retrieval) — it never accepts an mcp_id sent by the client, and
// that's the root of the isolation: a card can never touch another MCP's slot. member
// (the durable identity behind the session) is the scope; public/byoai has no member →
// nowhere to store. An unauthorized tool → 404 (same status as tool dispatch).
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

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
)

// AppStateStore —— the mcp_app_state persistence layer (injected by the route; wireup
// plugs in the postgres repo).
type AppStateStore interface {
	Set(ctx context.Context, ref conversation.AppStateRef, value []byte) error
	Get(ctx context.Context, memberID, mcpID string) (map[string]json.RawMessage, error)
	Delete(ctx context.Context, memberID, mcpID, key string) error
}

// appStateResp / appStateAck / appStateErr —— typed JSON responses (business code bans
// any).
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

// appScope —— the (member, owner, mcp_id) resolved for one app-state request.
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
	ref := conversation.AppStateRef{
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

// resolveAppScope —— auth → assembly → derive mcp_id + ACL from tool (tool must be
// present in the assembled bindings = authorized). Empty member (no durable identity)
// → 403, state has nowhere to attach.
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

// scopeForTool —— derives mcp_id + ACL from {tool} (tool must already be authorized).
// Multiple tools on the same MCP (calendar_book / calendar_list_slots) map to the same
// id → they share one app-state slot.
//
// **Ask one question, don't assemble everything.** This used to call AssembleVisitor
// first, instantiating every capability just to translate a tool name into a capability
// id off the binding — instantiating an external capability means spinning up a bwrap
// sandbox, so every time a card read or wrote its own state slot, the whole row of
// sandboxes cold-started. Measured: one app-state read took 6 seconds, the card stayed
// empty the whole time, and assertions timed out (this is the third in the same family
// as the ticket that caught the tool-call case at #17 and the session-open case at #22).
//
// Ownership is static information, and the registry can usually answer it without
// dialing out at all (MCPIDForTool). Hand the question to it, and this layer no longer
// gets a chance to pick the expensive path again.
func (h *Handlers) scopeForTool(
	w http.ResponseWriter, r *http.Request, data *access.VisitorSessionData,
) (appScope, bool) {
	in := assembleInputFromSession(data, chi.URLParam(r, "id"))
	mcpID, found := h.Visitor.AgentSkills.MCPIDForTool(r.Context(), in, chi.URLParam(r, "tool"))
	if !found {
		writeAppStateErr(h.Log, w, http.StatusNotFound, "tool_not_enabled")
		return appScope{}, false
	}
	return appScope{memberID: data.MemberID, ownerID: data.OwnerID, mcpID: mcpID}, true
}

// readAppStateValue —— reads {value:<json>} from the body; missing/malformed → 400.
// value is stored opaque.
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
