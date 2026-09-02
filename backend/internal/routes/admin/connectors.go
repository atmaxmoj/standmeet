// connectors.go — #155 generic connector admin routes (replaces the gcal/mail-specific
// routes). One set of endpoints handles connectors of any kind/category. Handlers only do
// presentation (cyclo ≤3); orchestration (oauth dance / credentials / slots) all lives in
// internal/connectorsvc. The OAuth callback goes through GET /{id}/callback → the service
// exchanges the token → redirects to /admin/connectors.

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
	// maxSpecBodyBytes — request body cap for creating/editing a connector (spec text +
	// JSON envelope headroom).
	maxSpecBodyBytes = 4 << 20 // 4 MiB
	paramID          = "id"
)

// ConnectorsAdminDeps — dependencies for the generic connector routes.
//
// Face — connector capability is taken through the outbound convergence point (declared
// on the connector axis). Svc still serves only the browser-specific handful: OAuth
// redirects, the plaintext credential form — those only ever belonged on this facade.
type ConnectorsAdminDeps struct {
	Svc  *connector.Service
	Face *dispatcher.Face
}

// MountConnectors — the /connectors subrouter.
func (h *Handlers) MountConnectors(r chi.Router) {
	r.Route("/connectors", func(r chi.Router) {
		face := h.ConnectorsAdmin.Face
		r.Get("/", h.dispatchOp(face, "connectors.list", emptyArgs, jsonListOK("connectors")))
		r.Get("/catalog",
			h.dispatchOp(face, "connectors.catalog", emptyArgs, jsonListOK("connectors")))
		// Which operations each connected connector exposes — the skill editor uses this
		// to offer an authorizable list, instead of asking the owner to hand-type a name
		// the product itself normalized (F-C-57).
		r.Get("/agent-ops",
			h.dispatchOp(face, "connectors.agent_ops", emptyArgs, jsonListOK("connectors")))
		r.Post("/", h.dispatchOp(face, "connectors.create", connectorWriteArgs, jsonCreated))
		h.mountDeclaredOps(r, face)
		r.Post("/validate-spec", h.dispatchOp(face, "connectors.validate_spec", bodyArgs, jsonOK))
		h.mountConnectorItem(r, face)
	})
}

// mountDeclaredOps mounts each connector's declared owner operations as routes:
// `POST /connectors/ops/<suffix>`.
//
// This used to be a hardcoded `POST /mail/test-send` → `connectors.mail_test_send`.
// Sending a test email is the **mail connector's** business, not the "connector
// registry's" business; it lived on the generic registry, which then had to know about
// mail — so a category's name showed up in the generic layer. Now the name comes from the
// declaration; this layer writes none.
func (h *Handlers) mountDeclaredOps(r chi.Router, face *dispatcher.Face) {
	for _, opID := range h.ConnectorsAdmin.Svc.DeclaredOwnerOpIDs() {
		seg, ok := strings.CutPrefix(opID, declaredOpPrefix)
		if !ok {
			continue // not under this naming convention, don't mount it
		}
		r.Post("/ops/"+seg, h.dispatchOp(face, opID, bodyArgs, jsonOK))
	}
}

// declaredOpPrefix — every connector-declared owner operation starts with this uniformly
// (see connector.OwnerOp.Name).
const declaredOpPrefix = "connectors."

// mountConnectorItem — the /{id} group. The first four routes go through the convergence
// point; the last four are browser-specific (OAuth redirect, plaintext credentials),
// belonging only on this facade, so they connect straight to the orchestration service as
// before.
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

// connectorWriteReq — Kind ""/"openapi" → uploads spec+binding; "protocol" → a protocol
// connector (Protocol picks caldav/smtp, Category is given explicitly; an openapi
// connector's category comes from the binding).
type connectorWriteReq struct {
	AuthScheme string `json:"auth_scheme"`
	BaseURL    string `json:"base_url"` // hand-filled by the owner when the spec has no servers
	SpecURL    string `json:"url"`      // spec fetched from a URL: no body from the panel
	Kind       string `json:"kind"`
	Protocol   string `json:"protocol"`
	Category   string `json:"category"`
	// raw text (JSON/YAML) pasted in the admin UI, takes priority over Spec
	SpecText string `json:"spec_text"`
	// raw binding text (YAML) pasted in the admin UI, takes priority over Binding
	BindingText        string          `json:"binding_text"`
	Spec               json.RawMessage `json:"spec"`
	Binding            json.RawMessage `json:"binding"`
	ExposeAsAgentTools bool            `json:"expose_as_agent_tools"`
}

// connectorWriteArgs / connectorUpdateArgs — panel body → the args the convergence point
// wants.
//
// The panel pastes in **raw text** (spec_text / binding_text — YAML doesn't need frontend
// parsing); e2e POSTs the spec / binding objects directly. The convergence point side
// only accepts one shape: two strings, spec / binding. This conversion is this facade's
// historical baggage, so it lands here.
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

// connectorOpArgs — the input shape connectors.create / connectors.update expect on the
// convergence point side.
type connectorOpArgs struct {
	ID                 string `json:"id,omitempty"`
	Kind               string `json:"kind,omitempty"`
	Protocol           string `json:"protocol,omitempty"`
	Category           string `json:"category,omitempty"`
	AuthScheme         string `json:"auth_scheme,omitempty"`
	BaseURL            string `json:"base_url,omitempty"`
	URL                string `json:"url,omitempty"`
	Spec               string `json:"spec,omitempty"`
	Binding            string `json:"binding,omitempty"`
	ExposeAsAgentTools bool   `json:"expose_as_agent_tools"`
}

func (b *connectorWriteReq) opArgs(id string) (json.RawMessage, error) {
	out, err := json.Marshal(connectorOpArgs{
		ID: id, Kind: b.Kind, Protocol: b.Protocol, Category: b.Category,
		AuthScheme:         b.AuthScheme,
		BaseURL:            b.BaseURL,
		URL:                b.SpecURL,
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

// rawOrText — prefers the raw text (JSON/YAML pasted in the admin UI), otherwise falls
// back to the JSON object (e2e's direct POST).
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
	// GrantedScopes — the ones actually granted (Scopes is the optional full list, this
	// is what was actually granted). The panel uses this to check the checkboxes;
	// without it, a connected connection looks like it has no permissions at all (F-C-33).
	GrantedScopes []string `json:"granted_scopes"`
	// Shortfall — the actions this authorization can't do + which scope each one is
	// still missing (F-B-8). The card uses this to say "shows connected, but this
	// authorization can't do X"; empty means it can do everything it declared.
	Shortfall []shortfallView `json:"shortfall"`
}

type shortfallView struct {
	Operation string   `json:"operation"`
	Needs     []string `json:"needs"`
}

func toShortfallViews(in []connector.ScopeShortfall) []shortfallView {
	out := make([]shortfallView, 0, len(in))
	for i := range in {
		out = append(out, shortfallView{Operation: in[i].Operation, Needs: orEmpty(in[i].Needs)})
	}
	return out
}

// connectorCredentialForm — the derived credential form (which fields the owner needs to
// fill to connect this connector).
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
		GrantedScopes: orEmpty(f.Granted),
		Shortfall:     toShortfallViews(f.Shortfall),
	}
}

// orEmpty — nil slice → empty slice (so JSON comes out as [] rather than null;
// check-no-nil-container).
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
