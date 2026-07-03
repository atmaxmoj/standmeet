// diag_sandbox.go —— GET  /internal/diag/sandbox/workspaces  列活跃 per-session 工作区
//                   —— POST /internal/diag/sandbox/workspace-ttl  设后端可控的工作区 TTL
//                   —— POST /internal/diag/sandbox/sweep          按需跑一次 cron 清扫
//
// 沙箱 per-session 工作区的生命周期面（#148）。TTL 后端可控、cron 周期清扫过期目录；
// 这里是诊断 / 测试钩子（按需 sweep + 列出当前），#147 的 admin 沙箱面板再在 UI 包它。
// /internal 不经外部 proxy 暴露，无 auth（同 /diag/registry）。

package sys

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/sandboxws"
)

// DiagSandboxDeps —— deps for the sandbox workspace lifecycle diag endpoints.
type DiagSandboxDeps struct {
	Workspaces *sandboxws.Manager
	Log        *slog.Logger
}

// MountDiagSandbox —— 挂三个 endpoint。Workspaces 为 nil（未配工作区子系统）→ 不挂。
func MountDiagSandbox(r chi.Router, deps DiagSandboxDeps) {
	if deps.Workspaces == nil {
		return
	}
	r.Get("/diag/sandbox/workspaces", diagWorkspaceListHandler(deps))
	r.Post("/diag/sandbox/workspace-ttl", diagWorkspaceTTLHandler(deps))
	r.Post("/diag/sandbox/sweep", diagWorkspaceSweepHandler(deps))
}

// MountAdminSandbox —— #147 owner-authed admin sandbox 面。复用同一批 handler,挂在
// /api/admin/sandbox/*(server 在 WithOwner+RequireCSRF group 内调,故天然 owner-authed +
// CSRF 保护)。Workspaces 为 nil(未配工作区子系统)→ 不挂。
func MountAdminSandbox(r chi.Router, deps DiagSandboxDeps) {
	if deps.Workspaces == nil {
		return
	}
	r.Get("/sandbox/workspaces", diagWorkspaceListHandler(deps))
	r.Post("/sandbox/ttl", diagWorkspaceTTLHandler(deps))
	r.Post("/sandbox/sweep", diagWorkspaceSweepHandler(deps))
}

type workspaceListResp struct {
	Workspaces []sandboxws.Workspace `json:"workspaces"`
}

func diagWorkspaceListHandler(deps DiagSandboxDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		list, err := deps.Workspaces.List()
		if err != nil {
			deps.Log.Error("sandbox workspace list", "err", err)
			http.Error(w, `{"error":"list failed"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(workspaceListResp{Workspaces: list}); eerr != nil {
			deps.Log.Error("sandbox workspace list encode", "err", eerr)
		}
	}
}

type workspaceTTLReq struct {
	Seconds int `json:"seconds"`
}

func diagWorkspaceTTLHandler(deps DiagSandboxDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		secs, ok := decodeTTLSeconds(r)
		if !ok {
			http.Error(w, `{"error":"bad seconds"}`, http.StatusBadRequest)
			return
		}
		deps.Workspaces.SetTTL(time.Duration(secs) * time.Second)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(workspaceSweepResp{OK: true}); eerr != nil {
			deps.Log.Error("sandbox workspace ttl encode", "err", eerr)
		}
	}
}

// decodeTTLSeconds —— parse + validate the {seconds} body. (false → 400.)
func decodeTTLSeconds(r *http.Request) (int, bool) {
	var req workspaceTTLReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return 0, false
	}
	if req.Seconds < 0 {
		return 0, false
	}
	return req.Seconds, true
}

type workspaceSweepResp struct {
	Removed int  `json:"removed"`
	OK      bool `json:"ok"`
}

func diagWorkspaceSweepHandler(deps DiagSandboxDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		removed, err := deps.Workspaces.Sweep()
		if err != nil {
			deps.Log.Error("sandbox workspace sweep", "err", err)
			http.Error(w, `{"error":"sweep failed"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		resp := workspaceSweepResp{Removed: removed, OK: true}
		if eerr := json.NewEncoder(w).Encode(resp); eerr != nil {
			deps.Log.Error("sandbox workspace sweep encode", "err", eerr)
		}
	}
}
