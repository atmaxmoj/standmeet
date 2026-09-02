// diag_sandbox.go —— GET  /internal/diag/sandbox/workspaces  lists active per-session
//                                                             workspaces
//                   —— POST /internal/diag/sandbox/workspace-ttl  sets the backend-
//                                                                 controlled workspace TTL
//                   —— POST /internal/diag/sandbox/sweep          runs a cron sweep on
//                                                                 demand
//
// The lifecycle face for sandbox per-session workspaces (#148). TTL is backend-controlled;
// cron periodically sweeps expired dirs. This file is the diagnostic / test hook (sweep
// on demand + list current state); #147's admin sandbox panel wraps this in the UI later.
// /internal isn't exposed by the external proxy, no auth (same as /diag/registry).

package sys

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/capabilities/sandboxws"
)

// DiagSandboxDeps —— deps for the sandbox workspace lifecycle diag endpoints.
type DiagSandboxDeps struct {
	Workspaces *sandboxws.Manager
	Log        *slog.Logger
}

// MountDiagSandbox —— mounts the three endpoints. Workspaces is nil (workspace
// subsystem not configured) -> don't mount.
func MountDiagSandbox(r chi.Router, deps DiagSandboxDeps) {
	if deps.Workspaces == nil {
		return
	}
	r.Get("/diag/sandbox/workspaces", diagWorkspaceListHandler(deps))
	r.Post("/diag/sandbox/workspace-ttl", diagWorkspaceTTLHandler(deps))
	r.Post("/diag/sandbox/sweep", diagWorkspaceSweepHandler(deps))
}

// MountAdminSandbox —— #147's owner-authed admin sandbox face. Reuses the same handlers,
// mounted under /api/admin/sandbox/* (the server calls this inside a WithOwner+RequireCSRF
// group, so it's naturally owner-authed + CSRF-protected). Workspaces is nil (workspace
// subsystem not configured) -> don't mount.
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
