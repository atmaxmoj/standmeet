// write.go —— write operations for the generic registry: create / edit / delete /
// activate / disconnect / validate spec (declared in ops.go).
//
// The orchestration itself lives in internal/connector's Service (fetching the spec /
// assembly / persisting / OAuth); this file only parses args, hands off, and
// translates the receipt.

package axisconn

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/connector"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// connectorOps —— the small set of things the generic registry needs.
type connectorOps struct {
	svc *connector.Service
	// slots —— only for connectors.agent_ops: it needs to ask "which operations
	// does this connected connector expose", and that lives in the live hub, not
	// in the DB.
	slots *connector.Slots
}

func newConnectorOps(d *deps.Runtime) connectorOps {
	return connectorOps{svc: NewService(d), slots: d.ConnectorSlots}
}

func connectorWriteOps(ops connectorOps) []fp.Op {
	return []fp.Op{
		{
			ID: "connectors.create",
			Description: "Create a connector. kind 'protocol' builds a protocol connector " +
				"(protocol caldav/smtp, explicit category); otherwise uploads an openapi " +
				"connector from a spec + JSONata binding.",
			InputSchema: connectorCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createConnector(ops),
		},
		{
			ID: "connectors.update",
			Description: "Edit an uploaded openapi connector's spec + binding (built-in " +
				"connectors are read-only).",
			InputSchema: connectorUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateConnector(ops),
		},
		{
			ID: "connectors.delete",
			Description: "Delete an owner-built connector (built-in connectors are " +
				"read-only and cannot be deleted).",
			InputSchema: connectorIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      connectorIDAction(ops.svc.Delete, "delete connector"),
		},
		{
			ID:          "connectors.activate",
			Description: "Activate a connector into its category slot (make it the active one).",
			InputSchema: connectorIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      connectorIDAction(ops.svc.Activate, "activate connector"),
		},
		{
			ID: "connectors.disconnect",
			Description: "Soft-disconnect a connector (clear tokens; keep credentials). A " +
				"connected sibling in the same category is promoted to active if one exists.",
			InputSchema: connectorIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      connectorIDAction(ops.svc.Disconnect, "disconnect connector"),
		},
		{
			ID: "connectors.validate_spec",
			Description: "Validate an OpenAPI spec (inline text or fetched from a URL) before " +
				"creating a connector. Returns a candidate title + derived auth forms, or a " +
				"human-readable rejection reason.",
			InputSchema: connectorValidateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      validateConnectorSpec(ops),
		},
	}
}

var (
	connectorCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"kind":{"type":"string","description":"'protocol' or 'openapi' (default)."},
			"protocol":{"type":"string","description":"Protocol connector: caldav / smtp."},
			"category":{"type":"string","description":"Protocol connector category."},
			"auth_scheme":{"type":"string","description":"Selected OpenAPI auth scheme."},
			"base_url":{"type":"string","description":"Base URL if the spec has none."},
			"url":{"type":"string","description":"Fetch the spec from here if no text."},
			"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
			"binding":{"type":"string","description":"JSONata binding text (YAML)."},
			"expose_as_agent_tools":{"type":"boolean","description":"Expose raw ops as tools."}
		}
	}`)

	connectorUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string","description":"Connector id."},
			"auth_scheme":{"type":"string","description":"Selected OpenAPI auth scheme."},
			"base_url":{"type":"string","description":"Base URL if the spec has none."},
			"url":{"type":"string","description":"Fetch the spec from here if no text."},
			"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
			"binding":{"type":"string","description":"JSONata binding text (YAML)."},
			"expose_as_agent_tools":{"type":"boolean","description":"Expose raw ops as tools."}
		},
		"required":["id"]
	}`)

	connectorValidateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
			"url":{"type":"string","description":"URL to fetch the spec from (optional)."},
			"base_url":{"type":"string","description":"Base URL if the spec has none."}
		}
	}`)
)

// connectorOKOut —— the receipt for an id-shaped action.
type connectorOKOut struct {
	ID string `json:"id"`
	OK bool   `json:"ok"`
}

// connectorIDAction —— delete / activate / disconnect differ only in which method
// they call; parsing and the receipt are shared.
func connectorIDAction(
	apply func(ctx context.Context, ownerID, id string) error, what string,
) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseConnectorID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := apply(ctx, ownerID, id); err != nil {
			return nil, connErr(what, err)
		}
		return json.Marshal(connectorOKOut{ID: id, OK: true})
	}
}

// connectorCreateArgs —— kind ""/"openapi" → pass spec+binding; "protocol" → a
// protocol connector. URL: when the spec is fetched from a URL, the caller sends no
// body and this layer fetches it instead.
type connectorCreateArgs struct {
	Kind               string `json:"kind"`
	Protocol           string `json:"protocol"`
	Category           string `json:"category"`
	AuthScheme         string `json:"auth_scheme"`
	BaseURL            string `json:"base_url"`
	URL                string `json:"url"`
	Spec               string `json:"spec"`
	Binding            string `json:"binding"`
	ExposeAsAgentTools bool   `json:"expose_as_agent_tools"`
}

func (a *connectorCreateArgs) uploaded() *connector.UploadedSpec {
	return &connector.UploadedSpec{
		AuthScheme: a.AuthScheme, BaseURL: a.BaseURL, URL: a.URL,
		Spec: []byte(a.Spec), Binding: []byte(a.Binding),
		ExposeAsAgentTools: a.ExposeAsAgentTools,
	}
}

type connectorCreatedOut struct {
	ID string `json:"id"`
}

func createConnector(ops connectorOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in connectorCreateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		id, err := createByKind(ctx, ops, ownerID, &in)
		if err != nil {
			return nil, connErr("create connector", err)
		}
		return json.Marshal(connectorCreatedOut{ID: id})
	}
}

// createByKind —— protocol goes through the protocol connector, everything else
// goes through the uploaded spec.
func createByKind(
	ctx context.Context, ops connectorOps, ownerID string, in *connectorCreateArgs,
) (string, error) {
	if in.Kind == "protocol" {
		return ops.svc.CreateProtocol(ctx, ownerID, in.Category, in.Protocol)
	}
	return ops.svc.CreateUploaded(ctx, ownerID, in.uploaded())
}

type connectorUpdateArgs struct {
	ID                 string `json:"id"`
	AuthScheme         string `json:"auth_scheme"`
	BaseURL            string `json:"base_url"`
	URL                string `json:"url"`
	Spec               string `json:"spec"`
	Binding            string `json:"binding"`
	ExposeAsAgentTools bool   `json:"expose_as_agent_tools"`
}

func updateConnector(ops connectorOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in connectorUpdateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		if err := ops.svc.UpdateUploaded(ctx, ownerID, in.ID, &connector.UploadedSpec{
			AuthScheme: in.AuthScheme, BaseURL: in.BaseURL, URL: in.URL,
			Spec: []byte(in.Spec), Binding: []byte(in.Binding),
			ExposeAsAgentTools: in.ExposeAsAgentTools,
		}); err != nil {
			return nil, connErr("update connector", err)
		}
		return json.Marshal(connectorOKOut{ID: in.ID, OK: true})
	}
}

type connectorValidateArgs struct {
	Spec    string `json:"spec"`
	URL     string `json:"url"`
	BaseURL string `json:"base_url"`
}

// connectorVerdictOut —— the result of validating a spec. auth passes through
// as-is: its shape is decided by that spec, this layer isn't meant to understand
// it, so it's already-marshaled JSON.
type connectorVerdictOut struct {
	Title string          `json:"title"`
	Error string          `json:"error"`
	Auth  json.RawMessage `json:"auth"`
	OK    bool            `json:"ok"`
}

func validateConnectorSpec(ops connectorOps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in connectorValidateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		v := ops.svc.ValidateSpec(ctx, []byte(in.Spec), in.URL, in.BaseURL)
		auth, aerr := json.Marshal(v.Auth)
		if aerr != nil {
			// failing to marshal the auth form should only lose this one half —
			// it shouldn't stop the owner from even learning "is this spec good".
			auth = json.RawMessage(`null`)
		}
		return json.Marshal(connectorVerdictOut{
			OK: v.OK, Title: v.Title, Error: v.Reason, Auth: auth,
		})
	}
}
