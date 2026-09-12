// write.go —— write operations for the generic registry: create / edit / delete /
// activate / disconnect / validate spec (declared in supplier_ops.go).
//
// The orchestration itself lives in blockadmin's Service (fetching the spec /
// assembly / persisting / OAuth); this file only parses args, hands off, and
// translates the receipt.

package blockwire

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockadmin"
)

// supplierOps —— the small set of things the generic registry needs.
type supplierOps struct {
	svc *blockadmin.Service
	// sups —— only for the agent-ops read: it asks "which operations does this
	// connected block expose", and that is a fact about the assembled instance, not
	// about the row in the database.
	sups *adapters.Suppliers
}

func newSupplierOps(d *deps.Runtime) supplierOps {
	return supplierOps{svc: NewService(d), sups: d.BlockSuppliers}
}

func supplierWriteOps(ops supplierOps) []fp.Op {
	return []fp.Op{
		{
			ID: "suppliers.create",
			Description: "Create a supplier. kind 'protocol' builds a protocol supplier " +
				"(protocol caldav/smtp, explicit seam); otherwise uploads an openapi " +
				"supplier from a spec + JSONata binding.",
			InputSchema: supplierCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createSupplier(ops),
		},
		{
			ID: "suppliers.update",
			Description: "Edit an uploaded openapi supplier's spec + binding (built-in " +
				"suppliers are read-only).",
			InputSchema: supplierUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateSupplier(ops),
		},
		{
			ID: "suppliers.delete",
			Description: "Delete an owner-built supplier (built-in suppliers are " +
				"read-only and cannot be deleted).",
			InputSchema: supplierIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      supplierIDAction(ops.svc.Delete, "delete supplier"),
		},
		{
			ID:          "suppliers.activate",
			Description: "Activate a supplier into its seam slot (make it the active one).",
			InputSchema: supplierIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      supplierIDAction(ops.svc.Activate, "activate supplier"),
		},
		{
			ID: "suppliers.disconnect",
			Description: "Soft-disconnect a supplier (clear tokens; keep credentials). A " +
				"connected sibling on the same seam is promoted to active if one exists.",
			InputSchema: supplierIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      supplierIDAction(ops.svc.Disconnect, "disconnect supplier"),
		},
		{
			ID: "suppliers.validate_spec",
			Description: "Validate an OpenAPI spec (inline text or fetched from a URL) before " +
				"creating a supplier. Returns a candidate title + derived auth forms, or a " +
				"human-readable rejection reason.",
			InputSchema: supplierValidateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      validateSupplierSpec(ops),
		},
	}
}

var (
	supplierCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"kind":{"type":"string","description":"'protocol' or 'openapi' (default)."},
			"protocol":{"type":"string","description":"Protocol supplier: caldav / smtp."},
			"seam":{"type":"string","description":"Protocol supplier seam."},
			"auth_scheme":{"type":"string","description":"Selected OpenAPI auth scheme."},
			"base_url":{"type":"string","description":"Base URL if the spec has none."},
			"url":{"type":"string","description":"Fetch the spec from here if no text."},
			"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
			"binding":{"type":"string","description":"JSONata binding text (YAML)."},
			"expose_as_agent_tools":{"type":"boolean","description":"Expose raw ops as tools."}
		}
	}`)

	supplierUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string","description":"Supplier block id."},
			"auth_scheme":{"type":"string","description":"Selected OpenAPI auth scheme."},
			"base_url":{"type":"string","description":"Base URL if the spec has none."},
			"url":{"type":"string","description":"Fetch the spec from here if no text."},
			"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
			"binding":{"type":"string","description":"JSONata binding text (YAML)."},
			"expose_as_agent_tools":{"type":"boolean","description":"Expose raw ops as tools."}
		},
		"required":["id"]
	}`)

	supplierValidateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
			"url":{"type":"string","description":"URL to fetch the spec from (optional)."},
			"base_url":{"type":"string","description":"Base URL if the spec has none."}
		}
	}`)
)

// supplierOKOut —— the receipt for an id-shaped action.
type supplierOKOut struct {
	ID string `json:"id"`
	OK bool   `json:"ok"`
}

// supplierIDAction —— delete / activate / disconnect differ only in which method
// they call; parsing and the receipt are shared.
func supplierIDAction(
	apply func(ctx context.Context, ownerID, id string) error, what string,
) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseSupplierID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := apply(ctx, ownerID, id); err != nil {
			return nil, supplierErr(what, err)
		}
		return json.Marshal(supplierOKOut{ID: id, OK: true})
	}
}

// supplierCreateArgs —— kind ""/"openapi" → pass spec+binding; "protocol" → a
// protocol supplier. URL: when the spec is fetched from a URL, the caller sends no
// body and this layer fetches it instead.
type supplierCreateArgs struct {
	Kind               string `json:"kind"`
	Protocol           string `json:"protocol"`
	Seam               string `json:"seam"`
	AuthScheme         string `json:"auth_scheme"`
	BaseURL            string `json:"base_url"`
	URL                string `json:"url"`
	Spec               string `json:"spec"`
	Binding            string `json:"binding"`
	ExposeAsAgentTools bool   `json:"expose_as_agent_tools"`
}

func (a *supplierCreateArgs) uploaded() *blockadmin.UploadedSpec {
	return &blockadmin.UploadedSpec{
		AuthScheme: a.AuthScheme, BaseURL: a.BaseURL, URL: a.URL,
		Spec: []byte(a.Spec), Binding: []byte(a.Binding),
		ExposeAsAgentTools: a.ExposeAsAgentTools,
	}
}

type supplierCreatedOut struct {
	ID string `json:"id"`
}

func createSupplier(ops supplierOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in supplierCreateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		id, err := createByKind(ctx, ops, ownerID, &in)
		if err != nil {
			return nil, supplierErr("create supplier", err)
		}
		return json.Marshal(supplierCreatedOut{ID: id})
	}
}

// createByKind —— protocol goes through the protocol supplier, everything else
// goes through the uploaded spec.
func createByKind(
	ctx context.Context, ops supplierOps, ownerID string, in *supplierCreateArgs,
) (string, error) {
	if in.Kind == "protocol" {
		return ops.svc.CreateProtocol(ctx, ownerID, in.Seam, in.Protocol)
	}
	return ops.svc.CreateUploaded(ctx, ownerID, in.uploaded())
}

type supplierUpdateArgs struct {
	ID                 string `json:"id"`
	AuthScheme         string `json:"auth_scheme"`
	BaseURL            string `json:"base_url"`
	URL                string `json:"url"`
	Spec               string `json:"spec"`
	Binding            string `json:"binding"`
	ExposeAsAgentTools bool   `json:"expose_as_agent_tools"`
}

func updateSupplier(ops supplierOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in supplierUpdateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		if err := ops.svc.UpdateUploaded(ctx, ownerID, in.ID, &blockadmin.UploadedSpec{
			AuthScheme: in.AuthScheme, BaseURL: in.BaseURL, URL: in.URL,
			Spec: []byte(in.Spec), Binding: []byte(in.Binding),
			ExposeAsAgentTools: in.ExposeAsAgentTools,
		}); err != nil {
			return nil, supplierErr("update supplier", err)
		}
		return json.Marshal(supplierOKOut{ID: in.ID, OK: true})
	}
}

type supplierValidateArgs struct {
	Spec    string `json:"spec"`
	URL     string `json:"url"`
	BaseURL string `json:"base_url"`
}

// supplierVerdictOut —— the result of validating a spec. auth passes through
// as-is: its shape is decided by that spec, this layer isn't meant to understand
// it, so it's already-marshaled JSON.
type supplierVerdictOut struct {
	Title string          `json:"title"`
	Error string          `json:"error"`
	Auth  json.RawMessage `json:"auth"`
	OK    bool            `json:"ok"`
}

func validateSupplierSpec(ops supplierOps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in supplierValidateArgs
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
		return json.Marshal(supplierVerdictOut{
			OK: v.OK, Title: v.Title, Error: v.Reason, Auth: auth,
		})
	}
}
