// connectors.go —— #155 通用连接器 admin 路由（替代 gcal/mail-specific 路由）。一套端点管任意
// kind/品类的连接器。handler 只做表现（cyclo ≤3）；编排（oauth dance / 凭据 / 槽位）全在
// internal/connectorsvc。OAuth callback 走 GET /{id}/callback → 服务换 token → 回 /admin/connectors。

package admin

import (
	"encoding/json"
	"errors"
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
		r.Post("/", h.createConnector())
		r.Route("/{id}", func(r chi.Router) {
			r.Put("/", h.updateConnector())
			r.Get("/credential-form", h.connectorCredentialForm())
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
	{Match: connectorsvc.ErrInvalidManifest, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "invalid_manifest",
		Message: "the connector spec or binding is invalid",
	}},
}

// writeConnErr —— 把 connectorsvc sentinel 翻成 HTTP envelope（dispatch 集中此处，handler 保 ≤3）。
// 装配失败带上底层原因（坏 JSONata / 未知 op / 未知品类 / 不完整），owner 才知道改哪。
func (h *Handlers) writeConnErr(w http.ResponseWriter, err error) {
	if errors.Is(err, connectorsvc.ErrInvalidManifest) {
		writeError(h.Log, w, apierr.Envelope{
			Status: http.StatusBadRequest, Code: "invalid_manifest", Message: err.Error(),
		})
		return
	}
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

type createConnectorReq struct {
	AuthScheme string          `json:"auth_scheme"`
	Spec       json.RawMessage `json:"spec"`
	Binding    json.RawMessage `json:"binding"`
}

// createConnector —— 上传一个 openapi 连接器（spec + JSONata binding）。201 {id}；坏 manifest → 400。
func (h *Handlers) createConnector() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		var body createConnectorReq
		dec := json.NewDecoder(io.LimitReader(r.Body, maxCredBytes))
		if derr := dec.Decode(&body); derr != nil {
			writeError(h.Log, w, apierr.Envelope{
				Status: http.StatusBadRequest, Code: "bad_request", Message: "invalid JSON body",
			})
			return
		}
		id, err := h.ConnectorsAdmin.Svc.CreateUploaded(
			r.Context(), ownerID, body.Spec, body.Binding, body.AuthScheme)
		if err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeCreated(h.Log, w, map[string]string{"id": id})
	}
}

// updateConnector —— 编辑已建上传连接器的 spec+binding（PUT）。坏 manifest / 内置 → 400。
func (h *Handlers) updateConnector() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		var body createConnectorReq
		dec := json.NewDecoder(io.LimitReader(r.Body, maxCredBytes))
		if derr := dec.Decode(&body); derr != nil {
			writeError(h.Log, w, apierr.Envelope{
				Status: http.StatusBadRequest, Code: "bad_request", Message: "invalid JSON body",
			})
			return
		}
		in := &connectorsvc.UploadedSpec{
			Spec: body.Spec, Binding: body.Binding, AuthScheme: body.AuthScheme,
		}
		if err := h.ConnectorsAdmin.Svc.UpdateUploaded(
			r.Context(), ownerID, chi.URLParam(r, paramID), in); err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}

type credFormField struct {
	Key string `json:"key"`
}

type credFormResp struct {
	AuthType string          `json:"auth_type"`
	Fields   []credFormField `json:"fields"`
}

// connectorCredentialForm —— 派生的凭据表单（owner 该填哪些字段连这个连接器）。
func (h *Handlers) connectorCredentialForm() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		form, err := h.ConnectorsAdmin.Svc.CredentialForm(
			r.Context(), ownerID, chi.URLParam(r, paramID))
		if err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeJSON(h.Log, w, toCredFormResp(&form))
	}
}

func toCredFormResp(f *connectorsvc.CredentialForm) credFormResp {
	fields := make([]credFormField, 0, len(f.Fields))
	for _, k := range f.Fields {
		fields = append(fields, credFormField{Key: k})
	}
	return credFormResp{AuthType: f.AuthType, Fields: fields}
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
