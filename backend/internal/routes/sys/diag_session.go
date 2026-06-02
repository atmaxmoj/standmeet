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

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/session"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// DiagSessionDeps —— deps for /diag/session.
type DiagSessionDeps struct {
	Sessions *session.VisitorSessionStore
	Registry *agentskills.Registry
	Log      *slog.Logger
}

// MountDiagSession —— /diag/session.
func MountDiagSession(r chi.Router, deps DiagSessionDeps) {
	r.Get("/diag/session", diagSessionHandler(deps))
}

type toolSpecWireV2 struct {
	Name string `json:"name"`
}

type diagSessionResp struct {
	SystemPromptHash string                        `json:"system_prompt_hash"`
	SystemPromptFull string                        `json:"system_prompt_full"`
	Capabilities     []agentskills.CapabilityState `json:"capabilities"`
	ToolSpecs        []toolSpecWireV2              `json:"tool_specs"`
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
	ctx context.Context, reg *agentskills.Registry,
	data *session.VisitorSessionData,
) diagSessionResp {
	in := &agentskills.AssembleInput{
		RoleSnapshot: data.RoleSnapshot,
		MaxBookings:  data.MaxBookings,
		OwnerID:      data.OwnerID,
		Mode:         data.Mode,
		CodeID:       data.CodeID,
		VisitorName:  data.VisitorName,
		// ConversationID 留空：diag endpoint 不绑定具体 conversation；
		// capability 实现按需 fallback (booker 没 conv ID 就跳 DB lookup)。
	}
	basePersona := usecases.ComposeBasePersona(data.RoleSnapshot)
	return diagSessionResp{
		Capabilities:     reg.VisitorStates(ctx, in),
		ToolSpecs:        toolSpecsFor(ctx, reg, in),
		SystemPromptHash: reg.SystemPromptHash(ctx, basePersona, in),
		SystemPromptFull: reg.ComposeSystemPrompt(ctx, basePersona, in),
	}
}

func toolSpecsFor(
	ctx context.Context, reg *agentskills.Registry, in *agentskills.AssembleInput,
) []toolSpecWireV2 {
	bindings := reg.AssembleVisitor(ctx, in)
	specs := make([]toolSpecWireV2, 0, len(bindings))
	for _, b := range bindings {
		specs = appendBindingToolSpecs(specs, b)
	}
	return specs
}

// appendBindingToolSpecs —— 拍平一个 binding 的所有 tool spec 名进 out，
// 顺便 release Close hook (introspect 用完即关，让 ext-mcp 计数 +1 后归零)。
func appendBindingToolSpecs(
	out []toolSpecWireV2, b *agentskills.Binding,
) []toolSpecWireV2 {
	for i := range b.Tools {
		out = append(out, toolSpecWireV2{Name: b.Tools[i].Name})
	}
	if b.Close != nil {
		b.Close()
	}
	return out
}

func writeSessionLookupErr(w http.ResponseWriter, err error) {
	if errors.Is(err, session.ErrVisitorSessionNotFound) {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	http.Error(w, "internal: "+err.Error(), http.StatusInternalServerError)
}
