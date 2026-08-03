// connectors.go —— #155 通用连接器 admin 路由（替代 gcal/mail-specific 路由）。一套端点管任意
// kind/品类的连接器。handler 只做表现（cyclo ≤3）；编排（oauth dance / 凭据 / 槽位）全在
// internal/connectorsvc。OAuth callback 走 GET /{id}/callback → 服务换 token → 回 /admin/connectors。

package admin

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

const (
	maxCredBytes = 64 << 10 // 64 KiB
	// maxSpecBodyBytes —— 建/改连接器的请求体上限（spec 文本 + JSON 信封余量）。
	maxSpecBodyBytes = 4 << 20 // 4 MiB
	paramID          = "id"
)

// ConnectorsAdminDeps —— 通用连接器路由依赖。
//
// Face —— 连接器的能力经出站收口取(声明在连接器轴那边)。Svc 只剩浏览器专属的那几条还在用:
// OAuth 跳转、明文凭据表单 —— 它们本来就只在这个面上。
type ConnectorsAdminDeps struct {
	Svc  *connector.Service
	Face *dispatcher.Face
}

// MountConnectors —— /connectors 子路由。
func (h *Handlers) MountConnectors(r chi.Router) {
	r.Route("/connectors", func(r chi.Router) {
		face := h.ConnectorsAdmin.Face
		r.Get("/", h.dispatchOp(face, "connectors.list", emptyArgs, jsonListOK("connectors")))
		r.Get("/catalog",
			h.dispatchOp(face, "connectors.catalog", emptyArgs, jsonListOK("connectors")))
		r.Post("/", h.dispatchOp(face, "connectors.create", connectorWriteArgs, jsonCreated))
		h.mountDeclaredOps(r, face)
		r.Post("/validate-spec", h.dispatchOp(face, "connectors.validate_spec", bodyArgs, jsonOK))
		h.mountConnectorItem(r, face)
	})
}

// mountDeclaredOps —— 把各连接器声明的 owner 操作挂成路由:`POST /connectors/ops/<后缀>`。
//
// 以前这里是一条写死的 `POST /mail/test-send` → `connectors.mail_test_send`。发一封测试信是
// **邮件连接器**的事,不是"连接器注册表"的事;它长在通用注册表上,注册表就得认识 mail ——
// 于是通用的那一层里出现了一个品类的名字。现在名字从声明来,这一层一个都不写。
func (h *Handlers) mountDeclaredOps(r chi.Router, face *dispatcher.Face) {
	for _, opID := range h.ConnectorsAdmin.Svc.DeclaredOwnerOpIDs() {
		seg, ok := strings.CutPrefix(opID, declaredOpPrefix)
		if !ok {
			continue // 不是这条命名规范下的,不挂
		}
		r.Post("/ops/"+seg, h.dispatchOp(face, opID, bodyArgs, jsonOK))
	}
}

// declaredOpPrefix —— 连接器声明的 owner 操作统一以此开头(见 connector.OwnerOp.Name)。
const declaredOpPrefix = "connectors."

// mountConnectorItem —— /{id} 那一组。前四条经收口;后四条是浏览器专属的(OAuth 跳转、
// 明文凭据),只在这个面上,所以照常直连编排服务。
func (h *Handlers) mountConnectorItem(r chi.Router, face *dispatcher.Face) {
	r.Route("/{id}", func(r chi.Router) {
		r.Put("/", h.dispatchOp(face, "connectors.update", connectorUpdateArgs, jsonOK))
		r.Get("/status", h.dispatchOp(face, "connectors.status", urlParamArgs(paramID), jsonOK))
		r.Post("/activate",
			h.dispatchOp(face, "connectors.activate", urlParamArgs(paramID), jsonOK))
		r.Post("/disconnect",
			h.dispatchOp(face, "connectors.disconnect", urlParamArgs(paramID), jsonOK))
		r.Delete("/", h.dispatchOp(face, "connectors.delete", urlParamArgs(paramID), jsonOK))
		r.Get("/credential-form", h.connectorCredentialForm())
		r.Post("/credentials", h.saveConnectorCredentials())
		r.Post("/connect", h.connectConnector())
		r.Get("/callback", h.connectorOAuthCallback())
	})
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

// connectorWriteArgs / connectorUpdateArgs —— 面板的 body → 收口要的 args。
//
// 面板贴的是**原文**(spec_text / binding_text,YAML 不必前端解析),e2e 直 POST 走
// spec / binding 对象。收口那边只认一份:spec / binding 两个字符串。这个换算是这个面的
// 历史包袱,所以落在这一处。
func connectorWriteArgs(r *http.Request) (json.RawMessage, error) {
	body, err := decodeConnectorWrite(r)
	if err != nil {
		return nil, err
	}
	return body.opArgs("")
}

func connectorUpdateArgs(r *http.Request) (json.RawMessage, error) {
	body, err := decodeConnectorWrite(r)
	if err != nil {
		return nil, err
	}
	return body.opArgs(chi.URLParam(r, paramID))
}

func decodeConnectorWrite(r *http.Request) (connectorWriteReq, error) {
	var body connectorWriteReq
	dec := json.NewDecoder(io.LimitReader(r.Body, maxSpecBodyBytes))
	if derr := dec.Decode(&body); derr != nil {
		return body, dispatcher.BadInput("invalid JSON body")
	}
	return body, nil
}

// connectorOpArgs —— 收口那边 connectors.create / connectors.update 的入参形状。
type connectorOpArgs struct {
	ID                 string `json:"id,omitempty"`
	Kind               string `json:"kind,omitempty"`
	Protocol           string `json:"protocol,omitempty"`
	Category           string `json:"category,omitempty"`
	AuthScheme         string `json:"auth_scheme,omitempty"`
	Spec               string `json:"spec,omitempty"`
	Binding            string `json:"binding,omitempty"`
	ExposeAsAgentTools bool   `json:"expose_as_agent_tools"`
}

func (b *connectorWriteReq) opArgs(id string) (json.RawMessage, error) {
	out, err := json.Marshal(connectorOpArgs{
		ID: id, Kind: b.Kind, Protocol: b.Protocol, Category: b.Category,
		AuthScheme:         b.AuthScheme,
		Spec:               string(rawOrText(b.Spec, b.SpecText)),
		Binding:            string(rawOrText(b.Binding, b.BindingText)),
		ExposeAsAgentTools: b.ExposeAsAgentTools,
	})
	if err != nil {
		return nil, dispatcher.BadInput("invalid request")
	}
	return out, nil
}

type connectInitResp struct {
	AuthURL   string `json:"auth_url,omitempty"`
	State     string `json:"state,omitempty"`
	Error     string `json:"error,omitempty"`
	Connected bool   `json:"connected"`
}

// rawOrText —— 优先用原文（admin UI 贴的 JSON/YAML），否则用 JSON 对象（e2e 直 POST）。
func rawOrText(raw json.RawMessage, text string) []byte {
	if text != "" {
		return []byte(text)
	}
	return raw
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
