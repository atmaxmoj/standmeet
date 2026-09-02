// diag_registry.go —— GET /internal/diag/registry
//                    —— GET /internal/diag/ext-mcp-stats
//
// Ops-facing diagnostic endpoints: lists registered Capabilities + shape (the first),
// reads ext MCP dial/close counts (the second). Useful for owner troubleshooting and
// e2e invariants specs alike.
//
// /internal is not exposed by the external reverse proxy by default, so no auth;
// it belongs to sysroutes the same way /healthz, /tls-ask, /builds do.

package sys

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// DiagRegistryDeps —— deps for /diag/registry + /diag/ext-mcp-stats.
type DiagRegistryDeps struct {
	Registry *capreg.Registry
	Log      *slog.Logger
}

// MountDiagRegistry —— /diag/registry + /diag/ext-mcp-stats. Both endpoints share the
// same deps and are mounted in the same file to avoid wireup noise.
func MountDiagRegistry(r chi.Router, deps DiagRegistryDeps) {
	r.Get("/diag/registry", diagRegistryListHandler(deps))
	r.Get("/diag/ext-mcp-stats", diagExtMCPStatsHandler(deps))
}

type registryCapWire struct {
	ID     string `json:"id"`
	Shape  string `json:"shape"`
	Origin string `json:"origin"`
}

type registryListResp struct {
	Capabilities []registryCapWire `json:"capabilities"`
}

func diagRegistryListHandler(deps DiagRegistryDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		caps := deps.Registry.List()
		resp := registryListResp{Capabilities: make([]registryCapWire, 0, len(caps))}
		for _, c := range caps {
			origin, _ := deps.Registry.OriginOf(c.ID())
			resp.Capabilities = append(resp.Capabilities, registryCapWire{
				ID: c.ID(), Shape: string(c.Shape()), Origin: string(origin),
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
