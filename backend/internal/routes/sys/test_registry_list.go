// test_registry_list.go —— GET /internal/test/registry-list
//                       —— GET /internal/test/ext-mcp-conn-stats
//
// 列出所有已注册 Capability + 其 shape（前者）；读 ext MCP dial/close 计数
// （后者）。invariants spec 据此校验：ID unique、shape 自洽、Close hook 计数
// 对齐。
//
// 仅 e2e 用；/internal 默认不被外部 reverse proxy 暴露。

package sys

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/agentskills"
)

// TestRegistryDeps —— deps for the /test/registry-list endpoint.
type TestRegistryDeps struct {
	Registry *agentskills.Registry
	Log      *slog.Logger
}

// MountTestRegistry —— /test/registry-list + /test/ext-mcp-conn-stats。
// 两个 endpoint 共享同一 deps，挂同一文件下避免 wireup 噪声。
func MountTestRegistry(r chi.Router, deps TestRegistryDeps) {
	r.Get("/test/registry-list", testRegistryListHandler(deps))
	r.Get("/test/ext-mcp-conn-stats", testExtMCPStatsHandler(deps))
}

type registryCapWire struct {
	ID    string `json:"id"`
	Shape string `json:"shape"`
}

type registryListResp struct {
	Capabilities []registryCapWire `json:"capabilities"`
}

func testRegistryListHandler(deps TestRegistryDeps) http.HandlerFunc {
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
			deps.Log.Error("registry-list encode", "err", err)
		}
	}
}

type extMCPStatsResp struct {
	Dialed int64 `json:"dialed"`
	Closed int64 `json:"closed"`
}

func testExtMCPStatsHandler(deps TestRegistryDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		stat := agentskills.ExtMCPStats()
		resp := extMCPStatsResp{Dialed: stat.Dialed, Closed: stat.Closed}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(&resp); err != nil {
			deps.Log.Error("ext-mcp-stats encode", "err", err)
		}
	}
}
