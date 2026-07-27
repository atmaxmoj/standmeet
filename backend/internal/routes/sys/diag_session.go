// diag_session.go —— GET /internal/diag/session
//
// 接 X-Session-Token，把 backend 装配给这个 session 的 capability map +
// tool spec + 完整 system prompt + hash 全吐出。Owner 排错 / e2e 验装配
// 结果都用得着 (含 enabled 状态、quota_remaining 计算等)；同 SendMessage
// 路径走同一 AssembleVisitor / ComposeSystemPrompt，所以 hash + body 反
// 映实际下行 prompt。

package sys

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/session"
)

// DiagSessionDeps —— deps for /diag/session.
type DiagSessionDeps struct {
	Sessions *session.VisitorSessionStore
	Registry *capreg.Registry
	Log      *slog.Logger
}

// MountDiagSession —— /diag/session.
func MountDiagSession(r chi.Router, deps DiagSessionDeps) {
	r.Get("/diag/session", diagSessionHandler(deps))
}

type toolSpecWireV2 struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type diagSessionResp struct {
	SystemPromptHash string                   `json:"system_prompt_hash"`
	SystemPromptFull string                   `json:"system_prompt_full"`
	Capabilities     []capreg.CapabilityState `json:"capabilities"`
	ToolSpecs        []toolSpecWireV2         `json:"tool_specs"`
	// Waypoints —— ghost-steering: 冻进 RoleSnapshot 的引导目的地（ACL 过滤后）+ ledger visited。
	// operator/e2e 观测 freeze 结果 + waypoint 到访状态。
	Waypoints []diagWaypoint `json:"waypoints"`
}

// diagWaypoint —— 冻结 waypoint + ledger visited 合并出到 diag。字段顺序按 fieldalignment。
type diagWaypoint struct {
	WaypointID   string   `json:"waypoint_id"`
	Description  string   `json:"description"`
	EvidenceRefs []string `json:"evidence_refs"`
	Weight       int      `json:"weight"`
	IsTerminal   bool     `json:"is_terminal"`
	Visited      bool     `json:"visited"`
}

func diagSessionHandler(deps DiagSessionDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Session-Token")
		if token == "" {
			http.Error(w, "missing X-Session-Token", http.StatusBadRequest)
			return
		}
		data, err := deps.Sessions.Get(r.Context(), token)
		if err != nil {
			writeSessionLookupErr(w, err)
			return
		}
		writeDiagSession(r.Context(), &deps, w, &data)
	}
}

func writeDiagSession(
	ctx context.Context, deps *DiagSessionDeps,
	w http.ResponseWriter, data *session.VisitorSessionData,
) {
	resp := buildDiagSessionResp(ctx, deps.Registry, data)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if eerr := json.NewEncoder(w).Encode(&resp); eerr != nil {
		deps.Log.Error("diag-session encode", "err", eerr)
	}
}

// buildDiagSessionResp —— pure 装配，无 IO；handler 只剩 encode。
// 让 handler 自身 cyclo ≤ 3，分支挪到 helper。
// 与 real SendMessage 路径走同一 AssembleVisitor / ComposeSystemPrompt，
// hash 反映实际下行 prompt。
func buildDiagSessionResp(
	ctx context.Context, reg *capreg.Registry,
	data *session.VisitorSessionData,
) diagSessionResp {
	in := &capreg.AssembleInput{
		RoleSnapshot: data.RoleSnapshot,
		OwnerID:      data.OwnerID,
		Mode:         data.Mode,
		CodeID:       data.CodeID,
		Visitor:      data.Visitor,
		// ConversationID 留空：diag endpoint 不绑定具体 conversation；
		// capability 实现按需 fallback (booker 没 conv ID 就跳 DB lookup)。
	}
	basePersona := conversation.ComposeBasePersona(data.RoleSnapshot)
	return diagSessionResp{
		Capabilities:     reg.VisitorStates(ctx, in),
		ToolSpecs:        toolSpecsFor(ctx, reg, in),
		SystemPromptHash: reg.SystemPromptHash(ctx, basePersona, in),
		SystemPromptFull: reg.ComposeSystemPrompt(ctx, basePersona, in),
		Waypoints:        diagWaypoints(data.RoleSnapshot.Waypoints(), data.VisitedWaypoints),
	}
}

// diagWaypoints —— 冻结 waypoints 逐条附上 ledger visited（waypoint_id ∈ VisitedWaypoints）。
func diagWaypoints(frozen []access.Waypoint, visited []string) []diagWaypoint {
	vset := make(map[string]bool, len(visited))
	for _, v := range visited {
		vset[v] = true
	}
	out := make([]diagWaypoint, 0, len(frozen))
	for i := range frozen {
		out = append(out, diagWaypoint{
			WaypointID: frozen[i].WaypointID, Description: frozen[i].Description,
			EvidenceRefs: frozen[i].EvidenceRefs, Weight: frozen[i].Weight,
			IsTerminal: frozen[i].IsTerminal, Visited: vset[frozen[i].WaypointID],
		})
	}
	return out
}

func toolSpecsFor(
	ctx context.Context, reg *capreg.Registry, in *capreg.AssembleInput,
) []toolSpecWireV2 {
	bindings := reg.AssembleVisitor(ctx, in)
	specs := make([]toolSpecWireV2, 0, len(bindings))
	for _, b := range bindings {
		specs = appendBindingToolSpecs(ctx, specs, b)
	}
	return specs
}

// appendBindingToolSpecs —— 拍平一个 binding 的所有 tool spec 名进 out，
// 顺便 release Close hook (introspect 用完即关，让 ext-mcp 计数 +1 后归零)。
func appendBindingToolSpecs(
	ctx context.Context, out []toolSpecWireV2, b *capreg.Binding,
) []toolSpecWireV2 {
	for i := range b.Tools {
		out = append(out, toolSpecWireV2{
			Name: b.Tools[i].Name, Description: toolDesc(ctx, &b.Tools[i]),
		})
	}
	if b.Close != nil {
		b.Close()
	}
	return out
}

// toolDesc —— 工具的描述（eino Tool.Info().Desc）；取不到 → 空。
func toolDesc(ctx context.Context, t *capreg.BindingTool) string {
	if info, err := t.Tool.Info(ctx); err == nil {
		return info.Desc
	}
	return ""
}

func writeSessionLookupErr(w http.ResponseWriter, err error) {
	if errors.Is(err, session.ErrVisitorSessionNotFound) {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	http.Error(w, "internal: "+err.Error(), http.StatusInternalServerError)
}
