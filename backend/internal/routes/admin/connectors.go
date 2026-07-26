// connectors.go —— #155 通用连接器 admin 路由（替代 gcal/mail-specific 路由）。一套端点管任意
// kind/品类的连接器。handler 只做表现（cyclo ≤3）；编排（oauth dance / 凭据 / 槽位）全在
// internal/connectorsvc。OAuth callback 走 GET /{id}/callback → 服务换 token → 回 /admin/connectors。

package admin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/middleware"
)

const (
	maxCredBytes = 64 << 10 // 64 KiB
	paramID      = "id"
)

// ConnectorsAdminDeps —— 通用连接器路由依赖：编排服务 + active mail 分派器（test-send 用）。
type ConnectorsAdminDeps struct {
	Svc      *connector.Service
	Mail     contract.MailProxy
	MailKind func(ctx context.Context, ownerID string) string
}

// MountConnectors —— /connectors 子路由。
func (h *Handlers) MountConnectors(r chi.Router) {
	r.Route("/connectors", func(r chi.Router) {
		r.Get("/", h.listConnectors())
		r.Get("/catalog", h.connectorCatalog())
		r.Post("/", h.createConnector())
		r.Post("/mail/test-send", h.mailTestSend())
		r.Post("/validate-spec", h.validateSpec())
		r.Route("/{id}", func(r chi.Router) {
			r.Put("/", h.updateConnector())
			r.Get("/credential-form", h.connectorCredentialForm())
			r.Post("/credentials", h.saveConnectorCredentials())
			r.Get("/status", h.connectorStatus())
			r.Post("/connect", h.connectConnector())
			r.Get("/callback", h.connectorOAuthCallback())
			r.Post("/activate", h.activateConnector())
			r.Post("/disconnect", h.disconnectConnector())
			r.Delete("/", h.deleteConnector())
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
	Error     string `json:"error,omitempty"`
	Connected bool   `json:"connected"`
}

func statusRow(c *connector.Connection) connectorStatusResp {
	return connectorStatusResp{
		ID: c.ConnectorID, Category: c.Category, Kind: c.Kind,
		HasCredentials: len(c.Credentials) > 0,
		Connected:      c.Connected, Active: c.Active,
	}
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

// connectorWriteReq —— Kind ""/"openapi" → 上传 spec+binding；"protocol" → 协议连接器（Protocol
// 选 caldav/smtp，Category 显式给；openapi 的品类由 binding 定）。
type connectorWriteReq struct {
	AuthScheme         string          `json:"auth_scheme"`
	Kind               string          `json:"kind"`
	Protocol           string          `json:"protocol"`
	Category           string          `json:"category"`
	SpecText           string          `json:"spec_text"`    // admin UI 贴的原文（JSON/YAML），优先于 Spec
	BindingText        string          `json:"binding_text"` // admin UI 贴的绑定原文（YAML），优先于 Binding
	Spec               json.RawMessage `json:"spec"`
	Binding            json.RawMessage `json:"binding"`
	ExposeAsAgentTools bool            `json:"expose_as_agent_tools"`
}

// uploadedSpec —— connectorWriteReq → connector.UploadedSpec（create + update 共用）。admin UI
// 走 spec_text/binding_text 原文（YAML 绑定不必前端解析）；e2e 直 POST 走 spec/binding 对象。
func (b *connectorWriteReq) uploadedSpec() *connector.UploadedSpec {
	return &connector.UploadedSpec{
		Spec: rawOrText(b.Spec, b.SpecText), Binding: rawOrText(b.Binding, b.BindingText),
		AuthScheme: b.AuthScheme, ExposeAsAgentTools: b.ExposeAsAgentTools,
	}
}

// rawOrText —— 优先用原文（admin UI 贴的 JSON/YAML），否则用 JSON 对象（e2e 直 POST）。
func rawOrText(raw json.RawMessage, text string) []byte {
	if text != "" {
		return []byte(text)
	}
	return raw
}

// decodeWriteBody —— 解 create/update 的 JSON body（限长 maxCredBytes）。坏 JSON → 写 400 + ok=false，
// 调用方据此早返。create/update 共用，免去逐 handler 抄解码样板。
func (h *Handlers) decodeWriteBody(
	w http.ResponseWriter, r *http.Request,
) (connectorWriteReq, bool) {
	var body connectorWriteReq
	dec := json.NewDecoder(io.LimitReader(r.Body, maxCredBytes))
	if derr := dec.Decode(&body); derr != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return connectorWriteReq{}, false
	}
	return body, true
}

// deleteConnector —— 删一个 owner 自建连接器（DELETE）。内置不可删 → 409；删后它填的品类 cap 复闸。
func (h *Handlers) deleteConnector() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		err := h.ConnectorsAdmin.Svc.Delete(r.Context(), ownerID, chi.URLParam(r, paramID))
		if err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}

// createConnectorID —— 按 kind 建连接器：protocol 走 CreateProtocol（无 spec）；其余走 CreateUploaded
// （openapi spec+binding）。
func createConnectorID(
	ctx context.Context, svc *connector.Service, ownerID string, body *connectorWriteReq,
) (string, error) {
	if body.Kind == "protocol" {
		return svc.CreateProtocol(ctx, ownerID, body.Category, body.Protocol)
	}
	return svc.CreateUploaded(ctx, ownerID, body.uploadedSpec())
}

// createConnector —— 上传一个 openapi 连接器（spec + JSONata binding）。201 {id}；坏 manifest → 400。
func (h *Handlers) createConnector() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		body, ok := h.decodeWriteBody(w, r)
		if !ok {
			return
		}
		id, err := createConnectorID(r.Context(), h.ConnectorsAdmin.Svc, ownerID, &body)
		if err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeCreated(h.Log, w, map[string]string{"id": id})
	}
}

// updateConnector —— 编辑已建上传连接器的 spec+binding（PUT）。坏 manifest → 400；内置 → 409。
func (h *Handlers) updateConnector() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		body, ok := h.decodeWriteBody(w, r)
		if !ok {
			return
		}
		in := body.uploadedSpec()
		if err := h.ConnectorsAdmin.Svc.UpdateUploaded(
			r.Context(), ownerID, chi.URLParam(r, paramID), in,
		); err != nil {
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
	Scopes   []string        `json:"scopes"`
	Schemes  []string        `json:"schemes"`
}

// connectorCredentialForm —— 派生的凭据表单（owner 该填哪些字段连这个连接器）。
func (h *Handlers) connectorCredentialForm() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		form, err := h.ConnectorsAdmin.Svc.CredentialForm(
			r.Context(), ownerID, chi.URLParam(r, paramID),
		)
		if err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeJSON(h.Log, w, toCredFormResp(&form))
	}
}

func toCredFormResp(f *connector.CredentialForm) credFormResp {
	fields := make([]credFormField, 0, len(f.Fields))
	for _, k := range f.Fields {
		fields = append(fields, credFormField{Key: k})
	}
	return credFormResp{
		AuthType: f.AuthType, Fields: fields,
		Scopes: orEmpty(f.Scopes), Schemes: orEmpty(f.Schemes),
	}
}

// orEmpty —— nil slice → 空切片（JSON 出 [] 而非 null；check-no-nil-container）。
func orEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
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
			r.Context(), ownerID, chi.URLParam(r, paramID), body,
		); serr != nil {
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
			AuthURL: res.AuthURL, State: res.State, Error: res.Error, Connected: res.Connected,
		})
	}
}

func (h *Handlers) activateConnector() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		if err := h.ConnectorsAdmin.Svc.Activate(
			r.Context(), ownerID, chi.URLParam(r, paramID),
		); err != nil {
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
			r.Context(), ownerID, chi.URLParam(r, paramID),
		); err != nil {
			h.writeConnErr(w, err)
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}
