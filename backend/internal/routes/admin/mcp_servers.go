// mcp_servers.go —— admin /mcp-servers endpoint：list / create / delete +
// /codes/{id}/mcp-servers PUT (attach 一组 mcp_server_id 给 code)。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// MCPServersAdminDeps —— admin mcp-servers handlers 依赖。
type MCPServersAdminDeps struct {
	Servers usecases.MCPServersDeps
}

type mcpServerView struct {
	CreatedAt      string `json:"created_at"`
	ID             string `json:"id"`
	Name           string `json:"name"`
	URL            string `json:"url"`
	AuthHeaderName string `json:"auth_header_name,omitempty"`
}

type createMCPServerRequest struct {
	Name            string `json:"name"`
	URL             string `json:"url"`
	AuthHeaderName  string `json:"auth_header_name"`
	AuthHeaderValue string `json:"auth_header_value"`
}

// MountMCPServers 挂 /mcp-servers。owner-registered server CRUD；attach to
// code 在 A.3-IAM-5 删了，mcp server 通过 role_mcp_servers 挂 role。
func (h *Handlers) MountMCPServers(r chi.Router) {
	r.Route("/mcp-servers", func(r chi.Router) {
		r.Get("/", h.listMCPServers())
		r.Post("/", h.createMCPServer())
		r.Delete("/{id}", h.deleteMCPServer())
		// owner 显式授权这个 ext-mcp server 接某 connector 依赖（最低信任，默认拒）。
		r.Post("/{id}/dep-grants", h.grantMCPServerDep())
	})
}

func (h *Handlers) listMCPServers() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := usecases.ListMCPServers(r.Context(), h.MCPServersAdmin.Servers, ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list mcp servers", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeMCPServersList(h.Log, w, rows)
	}
}

func writeMCPServersList(
	log *slog.Logger, w http.ResponseWriter, rows []marketplace.MCPServerConfig,
) {
	items := make([]mcpServerView, 0, len(rows))
	for i := range rows {
		items = append(items, toMCPServerView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(log, "encode mcp servers", err)
	}
}

func toMCPServerView(s *marketplace.MCPServerConfig) mcpServerView {
	return mcpServerView{
		ID: s.ID, Name: s.Name, URL: s.URL,
		AuthHeaderName: s.AuthHeaderName,
		CreatedAt:      s.CreatedAt.Format(time.RFC3339),
	}
}

func (h *Handlers) createMCPServer() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createMCPServerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runCreateMCPServer(r, h, w, &req)
	}
}

func runCreateMCPServer(
	r *http.Request, h *Handlers, w http.ResponseWriter, req *createMCPServerRequest,
) {
	ownerID := middleware.OwnerIDFrom(r.Context())
	in := &usecases.CreateMCPServerInput{
		OwnerID: ownerID, Name: req.Name, URL: req.URL,
		AuthHeaderName: req.AuthHeaderName, AuthHeaderValue: req.AuthHeaderValue,
	}
	cfg, err := usecases.CreateMCPServer(r.Context(), h.MCPServersAdmin.Servers, in)
	if err != nil {
		handleCreateMCPServerErr(h.Log, w, err)
		return
	}
	writeCreatedMCPServer(h.Log, w, &cfg)
}

func handleCreateMCPServerErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, usecases.ErrEmptyField):
		writeError(log, w, envBadReq("name and url are required"))
	case errors.Is(err, marketplace.ErrMCPServerNameTaken):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusConflict, Code: "mcp_server_name_taken",
			Message: "mcp server name already taken",
		})
	default:
		logEncodeErr(log, "create mcp server", err)
		writeError(log, w, serverErr())
	}
}

func writeCreatedMCPServer(
	log *slog.Logger, w http.ResponseWriter, s *marketplace.MCPServerConfig,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(toMCPServerView(s)); err != nil {
		logEncodeErr(log, "encode mcp server", err)
	}
}

func (h *Handlers) deleteMCPServer() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		serverID := chi.URLParam(r, "id")
		err := usecases.DeleteMCPServer(r.Context(), h.MCPServersAdmin.Servers, ownerID, serverID)
		if err != nil {
			handleDeleteMCPServerErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDeleteMCPServerErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, marketplace.ErrMCPServerNotFound) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "mcp_server_not_found",
			Message: "mcp server not found",
		})
		return
	}
	logEncodeErr(log, "delete mcp server", err)
	writeError(log, w, serverErr())
}

type depGrantRequest struct {
	Dep string `json:"dep"`
}

func (h *Handlers) grantMCPServerDep() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req depGrantRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		serverID := chi.URLParam(r, "id")
		err := usecases.GrantMCPServerDep(
			r.Context(), h.MCPServersAdmin.Servers, ownerID, serverID, req.Dep,
		)
		if err != nil {
			handleGrantMCPServerDepErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGrantMCPServerDepErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, usecases.ErrEmptyField):
		writeError(log, w, envBadReq("dep is required"))
	case errors.Is(err, marketplace.ErrMCPServerNotFound):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "mcp_server_not_found",
			Message: "mcp server not found",
		})
	default:
		logEncodeErr(log, "grant mcp server dep", err)
		writeError(log, w, serverErr())
	}
}

// setCodeMCPServers / attachCreatedCodeMCPServers / listMCPServerIDsForCode
// 在 A.3-IAM-5 删 —— mcp 通过 role_mcp_servers 挂 role。
