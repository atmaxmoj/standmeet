// diag_registry.go —— GET /internal/diag/registry
//                    —— GET /internal/diag/ext-mcp-stats
//
// 操作面诊断 endpoint: 列已注册 Capability + shape (前者) / 读 ext MCP
// dial/close 计数 (后者)。owner 排错 + e2e invariants spec 都用得着。
//
// /internal 默认不被外部 reverse proxy 暴露，所以无 auth；同 /healthz、
// /tls-ask、/builds 一样属 sysroutes。

package sys

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/capreg"
)

// DiagRegistryDeps —— deps for /diag/registry + /diag/ext-mcp-stats。
type DiagRegistryDeps struct {
	Registry *capreg.Registry
	Log      *slog.Logger
}

// MountDiagRegistry —— /diag/registry + /diag/ext-mcp-stats。两个 endpoint
// 共享同一 deps 挂同一文件下避免 wireup 噪声。
func MountDiagRegistry(r chi.Router, deps DiagRegistryDeps) {
	r.Get("/diag/registry", diagRegistryListHandler(deps))
	r.Get("/diag/ext-mcp-stats", diagExtMCPStatsHandler(deps))
}

type registryCapWire struct {
	ID    string `json:"id"`
	Shape string `json:"shape"`
}

type registryListResp struct {
	Capabilities []registryCapWire `json:"capabilities"`
}

func diagRegistryListHandler(deps DiagRegistryDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		caps := deps.Registry.List()
		resp := registryListResp{Capabilities: make([]registryCapWire, 0, len(caps))}
		for _, c := range caps {
			resp.Capabilities = append(resp.Capabilities, registryCapWire{
				ID: c.ID(), Shape: string(c.Shape()),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(&resp); err != nil {
			deps.Log.Error("registry encode", "err", err)
		}
	}
}

type extMCPStatsResp struct {
	Dialed int64 `json:"dialed"`
	Closed int64 `json:"closed"`
}

func diagExtMCPStatsHandler(deps DiagRegistryDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		stat := capreg.ExtMCPStats()
		resp := extMCPStatsResp{Dialed: stat.Dialed, Closed: stat.Closed}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(&resp); err != nil {
			deps.Log.Error("ext-mcp-stats encode", "err", err)
		}
	}
}
