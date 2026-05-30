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

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/usecases"
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

type setCodeMCPServersRequest struct {
	ServerIDs []string `json:"server_ids"`
}

// MountMCPServers 挂 /mcp-servers + /codes/{id}/mcp-servers。
func (h *Handlers) MountMCPServers(r chi.Router) {
	r.Route("/mcp-servers", func(r chi.Router) {
		r.Get("/", h.listMCPServers())
		r.Post("/", h.createMCPServer())
		r.Delete("/{id}", h.deleteMCPServer())
	})
	r.Put("/codes/{id}/mcp-servers", h.setCodeMCPServers())
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

func writeMCPServersList(log *slog.Logger, w http.ResponseWriter, rows []domain.MCPServerConfig) {
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

func toMCPServerView(s *domain.MCPServerConfig) mcpServerView {
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
	case errors.Is(err, domain.ErrMCPServerNameTaken):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusConflict, Code: "mcp_server_name_taken",
			Message: "mcp server name already taken",
		})
	default:
		logEncodeErr(log, "create mcp server", err)
		writeError(log, w, serverErr())
	}
}

func writeCreatedMCPServer(log *slog.Logger, w http.ResponseWriter, s *domain.MCPServerConfig) {
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
	if errors.Is(err, domain.ErrMCPServerNotFound) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "mcp_server_not_found",
			Message: "mcp server not found",
		})
		return
	}
	logEncodeErr(log, "delete mcp server", err)
	writeError(log, w, serverErr())
}

func (h *Handlers) setCodeMCPServers() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req setCodeMCPServersRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runSetCodeMCPServers(r, h, w, &req)
	}
}

func runSetCodeMCPServers(
	r *http.Request, h *Handlers, w http.ResponseWriter, req *setCodeMCPServersRequest,
) {
	ownerID := middleware.OwnerIDFrom(r.Context())
	codeID := chi.URLParam(r, "id")
	in := &usecases.SetCodeMCPServersInput{
		OwnerID: ownerID, CodeID: codeID, ServerIDs: req.ServerIDs,
	}
	if err := usecases.SetCodeMCPServers(r.Context(), h.MCPServersAdmin.Servers, in); err != nil {
		handleSetCodeMCPServersErr(h.Log, w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleSetCodeMCPServersErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrCodeInvalid):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "code_not_found", Message: "code not found",
		})
	case errors.Is(err, domain.ErrMCPServerNotFound):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusBadRequest, Code: "mcp_server_not_found",
			Message: "one or more mcp server ids do not exist",
		})
	default:
		logEncodeErr(log, "set code mcp servers", err)
		writeError(log, w, serverErr())
	}
}

// attachCreatedCodeMCPServers —— createCode 时 attach mcp_server_ids；空
// 列表跳过。failure caller 翻 envelope。
func attachCreatedCodeMCPServers(
	r *http.Request, h *Handlers, ownerID, codeID string, serverIDs []string,
) error {
	if len(serverIDs) == 0 {
		return nil
	}
	in := &usecases.SetCodeMCPServersInput{
		OwnerID: ownerID, CodeID: codeID, ServerIDs: serverIDs,
	}
	return usecases.SetCodeMCPServers(r.Context(), h.MCPServersAdmin.Servers, in)
}

// listMCPServerIDsForCode —— admin listCodes 视图回显用。失败 / 空 →
// 空 slice，跟 listSkillIDsForCode 一致。
func listMCPServerIDsForCode(r *http.Request, h *Handlers, codeID string) []string {
	if h.CodesAdmin.MCPServers == nil {
		return []string{}
	}
	ids, err := h.CodesAdmin.MCPServers.ListIDsForCode(r.Context(), codeID)
	if err != nil {
		h.Log.Error("list code mcp server ids", "code_id", codeID, "err", err)
		return []string{}
	}
	return ids
}
