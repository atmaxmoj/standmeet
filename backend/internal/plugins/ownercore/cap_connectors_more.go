package ownercore

// cap_connectors_more.go —— action tools for the connectors Capability (split
// from cap_connectors.go for max-lines): create / update / delete / activate /
// disconnect / validate_spec, plus their arg parsers and the shared arg-error
// sentinels. mail_test_send lives in cap_connectors.go.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
)

// errIDRequired —— missing required {id}. wrapArgs —— bad JSON args (wrapped so a
// helper never returns a bare error).
var errIDRequired = errors.New("id is required")

func wrapArgs(err error) error {
	return fmt.Errorf("invalid arguments: %w", err)
}

// ───── connectors.create ────────────────────────────────────────

// connectorCreateArgs —— kind ""/"openapi" → upload spec+binding; "protocol" →
// protocol connector (protocol=caldav/smtp, explicit category).
type connectorCreateArgs struct {
	Kind               string `json:"kind"`
	Protocol           string `json:"protocol"`
	Category           string `json:"category"`
	AuthScheme         string `json:"auth_scheme"`
	Spec               string `json:"spec"`
	Binding            string `json:"binding"`
	ExposeAsAgentTools bool   `json:"expose_as_agent_tools"`
}

func parseCreateArgs(raw json.RawMessage) (connectorCreateArgs, error) {
	var args connectorCreateArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, wrapArgs(err)
	}
	return args, nil
}

func (c *connectorsCapability) createBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "connectors.create",
		Description: "Create a connector. kind 'protocol' builds a protocol connector " +
			"(protocol caldav/smtp, explicit category); otherwise uploads an openapi " +
			"connector from a spec + JSONata binding.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"kind":{"type":"string","description":"'protocol' or 'openapi' (default)."},
				"protocol":{"type":"string","description":"Protocol connector: caldav / smtp."},
				"category":{"type":"string","description":"Protocol connector category."},
				"auth_scheme":{"type":"string","description":"Selected OpenAPI auth scheme."},
				"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
				"binding":{"type":"string","description":"JSONata binding text (YAML)."},
				"expose_as_agent_tools":{"type":"boolean","description":"Expose raw ops as tools."}
			}
		}`),
		Handler: c.handleCreate,
	}
}

func (c *connectorsCapability) handleCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseCreateArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	id, err := c.createConnector(ctx, ownerID, &args)
	if err != nil {
		c.log.Error("cap connectors.create", "err", err)
		return capreg.MCPError("connectors.create failed")
	}
	return mcputil.MarshalResult(c.log, "connectors.create", map[string]string{"id": id})
}

// createConnector —— route by kind (protocol → CreateProtocol; else CreateUploaded).
func (c *connectorsCapability) createConnector(
	ctx context.Context, ownerID string, args *connectorCreateArgs,
) (string, error) {
	if args.Kind == "protocol" {
		id, err := c.deps.Svc.CreateProtocol(ctx, ownerID, args.Category, args.Protocol)
		if err != nil {
			return "", fmt.Errorf("create protocol connector: %w", err)
		}
		return id, nil
	}
	id, err := c.deps.Svc.CreateUploaded(ctx, ownerID, args.uploadedSpec())
	if err != nil {
		return "", fmt.Errorf("create uploaded connector: %w", err)
	}
	return id, nil
}

func (a *connectorCreateArgs) uploadedSpec() UploadedSpecArg {
	return UploadedSpecArg{
		AuthScheme: a.AuthScheme, Spec: []byte(a.Spec), Binding: []byte(a.Binding),
		ExposeAsAgentTools: a.ExposeAsAgentTools,
	}
}

// ───── connectors.update ────────────────────────────────────────

type connectorUpdateArgs struct {
	ID                 string `json:"id"`
	AuthScheme         string `json:"auth_scheme"`
	Spec               string `json:"spec"`
	Binding            string `json:"binding"`
	ExposeAsAgentTools bool   `json:"expose_as_agent_tools"`
}

func parseUpdateArgs(raw json.RawMessage) (connectorUpdateArgs, error) {
	var args connectorUpdateArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, wrapArgs(err)
	}
	if args.ID == "" {
		return args, errIDRequired
	}
	return args, nil
}

func (c *connectorsCapability) updateBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "connectors.update",
		Description: "Edit an uploaded openapi connector's spec + binding (built-in " +
			"connectors are read-only).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Connector id."},
				"auth_scheme":{"type":"string","description":"Selected OpenAPI auth scheme."},
				"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
				"binding":{"type":"string","description":"JSONata binding text (YAML)."},
				"expose_as_agent_tools":{"type":"boolean","description":"Expose raw ops as tools."}
			},
			"required":["id"]
		}`),
		Handler: c.handleUpdate,
	}
}

func (c *connectorsCapability) handleUpdate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseUpdateArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	in := UploadedSpecArg{
		AuthScheme: args.AuthScheme, Spec: []byte(args.Spec), Binding: []byte(args.Binding),
		ExposeAsAgentTools: args.ExposeAsAgentTools,
	}
	if err := c.deps.Svc.UpdateUploaded(ctx, ownerID, args.ID, in); err != nil {
		c.log.Error("cap connectors.update", "err", err)
		return capreg.MCPError("connectors.update failed")
	}
	return mcputil.MarshalResult(c.log, "connectors.update", okRow(args.ID))
}

// ───── connectors.delete ────────────────────────────────────────

func (c *connectorsCapability) deleteBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "connectors.delete",
		Description: "Delete an owner-built connector (built-in connectors are " +
			"read-only and cannot be deleted).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Connector id."}
			},
			"required":["id"]
		}`),
		Handler: c.handleDelete,
	}
}

func (c *connectorsCapability) handleDelete(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseIDArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if err := c.deps.Svc.Delete(ctx, ownerID, args.ID); err != nil {
		c.log.Error("cap connectors.delete", "err", err)
		return capreg.MCPError("connectors.delete failed")
	}
	return mcputil.MarshalResult(c.log, "connectors.delete", okRow(args.ID))
}

// ───── connectors.activate ──────────────────────────────────────

func (c *connectorsCapability) activateBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "connectors.activate",
		Description: "Activate a connector into its category slot (make it the active one).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Connector id."}
			},
			"required":["id"]
		}`),
		Handler: c.handleActivate,
	}
}

func (c *connectorsCapability) handleActivate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseIDArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if err := c.deps.Svc.Activate(ctx, ownerID, args.ID); err != nil {
		c.log.Error("cap connectors.activate", "err", err)
		return capreg.MCPError("connectors.activate failed")
	}
	return mcputil.MarshalResult(c.log, "connectors.activate", okRow(args.ID))
}

// ───── connectors.disconnect ────────────────────────────────────

func (c *connectorsCapability) disconnectBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "connectors.disconnect",
		Description: "Soft-disconnect a connector (clear tokens; keep credentials). A " +
			"connected sibling in the same category is promoted to active if one exists.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Connector id."}
			},
			"required":["id"]
		}`),
		Handler: c.handleDisconnect,
	}
}

func (c *connectorsCapability) handleDisconnect(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseIDArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if err := c.deps.Svc.Disconnect(ctx, ownerID, args.ID); err != nil {
		c.log.Error("cap connectors.disconnect", "err", err)
		return capreg.MCPError("connectors.disconnect failed")
	}
	return mcputil.MarshalResult(c.log, "connectors.disconnect", okRow(args.ID))
}

// ───── connectors.validate_spec ─────────────────────────────────

type validateSpecArgs struct {
	Spec string `json:"spec"`
	URL  string `json:"url"`
}

func parseValidateSpecArgs(raw json.RawMessage) (validateSpecArgs, error) {
	var args validateSpecArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, wrapArgs(err)
	}
	return args, nil
}

func (c *connectorsCapability) validateSpecBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "connectors.validate_spec",
		Description: "Validate an OpenAPI spec (inline text or fetched from a URL) before " +
			"creating a connector. Returns a candidate title + derived auth forms, or a " +
			"human-readable rejection reason.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
				"url":{"type":"string","description":"URL to fetch the spec from (optional)."}
			}
		}`),
		Handler: c.handleValidateSpec,
	}
}

func (c *connectorsCapability) handleValidateSpec(
	ctx context.Context, _ string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseValidateSpecArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	v := c.deps.Svc.ValidateSpec(ctx, []byte(args.Spec), args.URL)
	return mcputil.MarshalResult(c.log, "connectors.validate_spec", map[string]any{
		"ok": v.OK, "title": v.Title, "error": v.Reason, "auth": v.Auth,
	})
}

// okRow —— {id, ok:true} success payload for id-scoped actions.
func okRow(id string) map[string]any {
	return map[string]any{"id": id, "ok": true}
}
