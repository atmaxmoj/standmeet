// test_visitor_capabilities.go —— GET /internal/test/visitor-capabilities
//
// 接 X-Session-Token，把 backend 装配给这个 session 的 capability map +
// tool spec + system prompt hash 全吐出。后续每个 B-N commit 加 capability
// 都靠此 endpoint 验装配结果（含 enabled 状态、quota_remaining 计算等）。
//
// 老 /test/visitor-tool-specs 仍然存在（B-3 之后可删）；这个是它的 superset。

package sys

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// TestVisitorCapabilitiesDeps —— deps for /test/visitor-capabilities.
type TestVisitorCapabilitiesDeps struct {
	Sessions *session.VisitorSessionStore
	Registry *agentskills.Registry
	Log      *slog.Logger
}

// MountTestVisitorCapabilities —— /test/visitor-capabilities。
func MountTestVisitorCapabilities(r chi.Router, deps TestVisitorCapabilitiesDeps) {
	r.Get("/test/visitor-capabilities", visitorCapabilitiesHandler(deps))
}

type toolSpecWireV2 struct {
	Name string `json:"name"`
}

type visitorCapabilitiesResp struct {
	SystemPromptHash string                        `json:"system_prompt_hash"`
	Capabilities     []agentskills.CapabilityState `json:"capabilities"`
	ToolSpecs        []toolSpecWireV2              `json:"tool_specs"`
}

func visitorCapabilitiesHandler(deps TestVisitorCapabilitiesDeps) http.HandlerFunc {
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
		writeVisitorCapabilities(r.Context(), &deps, w, &data)
	}
}

func writeVisitorCapabilities(
	ctx context.Context, deps *TestVisitorCapabilitiesDeps,
	w http.ResponseWriter, data *session.VisitorSessionData,
) {
	resp := buildVisitorCapabilitiesResp(ctx, deps.Registry, data)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if eerr := json.NewEncoder(w).Encode(&resp); eerr != nil {
		deps.Log.Error("visitor-capabilities encode", "err", eerr)
	}
}

// buildVisitorCapabilitiesResp —— pure 装配，无 IO；handler 只剩 encode。
// 让 handler 自身 cyclo ≤ 3，分支挪到 helper。
// 与 real SendMessage 路径走同一 AssembleVisitor / ComposeSystemPrompt，
// hash 反映实际下行 prompt。
func buildVisitorCapabilitiesResp(
	ctx context.Context, reg *agentskills.Registry,
	data *session.VisitorSessionData,
) visitorCapabilitiesResp {
	in := &agentskills.AssembleInput{
		RoleSnapshot: data.RoleSnapshot,
		MaxBookings:  data.MaxBookings,
		OwnerID:      data.OwnerID,
		Mode:         data.Mode,
		CodeID:       data.CodeID,
		VisitorName:  data.VisitorName,
		// ConversationID 留空：dev endpoint 不绑定具体 conversation；
		// capability 实现按需 fallback (booker 没 conv ID 就跳 DB lookup)。
	}
	return visitorCapabilitiesResp{
		Capabilities: reg.VisitorStates(ctx, in),
		ToolSpecs:    toolSpecsFor(ctx, reg, in),
		SystemPromptHash: reg.SystemPromptHash(
			ctx, usecases.ComposeBasePersona(data.RoleSnapshot), in,
		),
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
	for _, t := range b.Tools {
		out = append(out, toolSpecWireV2{Name: t.Spec.Name})
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
