// connectors.go —— #155 通用连接器 admin 路由（替代 gcal/mail-specific 路由）。一套端点管任意
// kind/品类的连接器。handler 只做表现（cyclo ≤3）；编排（oauth dance / 凭据 / 槽位）全在
// internal/connectorsvc。OAuth callback 走 GET /{id}/callback → 服务换 token → 回 /admin/connectors。

package admin

import (
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/connectorsvc"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
)

const (
	maxCredBytes = 64 << 10 // 64 KiB
	paramID      = "id"
)

// ConnectorsAdminDeps —— 通用连接器路由依赖：编排服务。
type ConnectorsAdminDeps struct {
	Svc *connectorsvc.Service
}

// MountConnectors —— /connectors 子路由。
func (h *Handlers) MountConnectors(r chi.Router) {
	r.Route("/connectors", func(r chi.Router) {
		r.Get("/", h.listConnectors())
		r.Route("/{id}", func(r chi.Router) {
			r.Post("/credentials", h.saveConnectorCredentials())
			r.Get("/status", h.connectorStatus())
			r.Post("/connect", h.connectConnector())
			r.Get("/callback", h.connectorOAuthCallback())
			r.Post("/activate", h.activateConnector())
			r.Post("/disconnect", h.disconnectConnector())
		})
	})
}

type connectorStatusResp struct {
	ID             string `json:"id"`
	Category       string `json:"category"`
	Kind           string `json:"kind"`
	HasCredentials bool   `json:"has_credentials"`
	Connected      bool   `json:"connected"`
	Active         bool   `json:"active"`
}

type connectorsListResp struct {
	Connectors []connectorStatusResp `json:"connectors"`
}

type connectInitResp struct {
	AuthURL   string `json:"auth_url,omitempty"`
	State     string `json:"state,omitempty"`
	Connected bool   `json:"connected"`
}

func statusRow(c *domain.ConnectorConnection) connectorStatusResp {
	return connectorStatusResp{
		ID: c.ConnectorID, Category: c.Category, Kind: c.Kind,
		HasCredentials: len(c.Credentials) > 0,
		Connected:      c.Connected, Active: c.Active,
	}
}

// connErrCases —— connectorsvc sentinel → HTTP envelope（table-driven，apierr.Classify 派发；
// 无匹配 → 500）。集中映射让 handler 保 cyclo ≤3。
var connErrCases = []apierr.Case{
	{Match: connectorsvc.ErrNotFound, Envelope: apierr.Envelope{
		Status: http.StatusNotFound, Code: "not_found", Message: "not found",
	}},
	{Match: connectorsvc.ErrNoOAuthClient, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "connector credentials not set",
	}},
	{Match: connectorsvc.ErrConnectionFailed, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "connection test failed — check host/port/credentials",
	}},
}

// writeConnErr —— 把 connectorsvc sentinel 翻成 HTTP envelope（dispatch 集中此处，handler 保 ≤3）。
func (h *Handlers) writeConnErr(w http.ResponseWriter, err error) {
	env := apierr.Classify(err, connErrCases)
	if env.Status >= http.StatusInternalServerError {
		h.Log.Error("connector admin", logErrKey, err)
	}
	writeError(h.Log, w, env)
}

func (h *Handlers) listConnectors() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		conns, err := h.ConnectorsAdmin.Svc.List(r.Context(), ownerID)
		if err != nil {
			h.writeConnErr(w, err)
			return
		}
		rows := make([]connectorStatusResp, 0, len(conns))
		for i := range conns {
			rows = append(rows, statusRow(&conns[i]))
		}
		writeJSON(h.Log, w, connectorsListResp{Connectors: rows})
	}
}

func (h *Handlers) saveConnectorCredentials() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		body, rerr := io.ReadAll(io.LimitReader(r.Body, maxCredBytes))
		if rerr != nil {
			writeError(h.Log, w, serverErr())
			return
		}
		if serr := h.ConnectorsAdmin.Svc.SaveCredentials(
			r.Context(), ownerID, chi.URLParam(r, paramID), body); serr != nil {
			h.writeConnErr(w, serr)
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}

func (h *Handlers) connectorStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		conn, err := h.ConnectorsAdmin.Svc.Status(r.Context(), ownerID, chi.URLParam(r, paramID))
		if err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeJSON(h.Log, w, statusRow(&conn))
	}
}

func (h *Handlers) connectConnector() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		res, err := h.ConnectorsAdmin.Svc.Connect(r.Context(), ownerID, chi.URLParam(r, paramID))
		if err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeJSON(h.Log, w, connectInitResp{
			AuthURL: res.AuthURL, State: res.State, Connected: res.Connected,
		})
	}
}

func (h *Handlers) connectorOAuthCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := h.ConnectorsAdmin.Svc.Callback(
			r.Context(), chi.URLParam(r, paramID),
			r.URL.Query().Get("code"), r.URL.Query().Get("state"))
		if err != nil {
			h.writeConnErr(w, err)
			return
		}
		http.Redirect(w, r, "/admin/connectors", http.StatusFound)
	}
}

func (h *Handlers) activateConnector() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		if err := h.ConnectorsAdmin.Svc.Activate(
			r.Context(), ownerID, chi.URLParam(r, paramID)); err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}

func (h *Handlers) disconnectConnector() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		if err := h.ConnectorsAdmin.Svc.Disconnect(
			r.Context(), ownerID, chi.URLParam(r, paramID)); err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}
