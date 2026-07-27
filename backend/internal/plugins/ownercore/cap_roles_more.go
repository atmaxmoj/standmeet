package ownercore

// cap_roles_more.go —— 2 additional owner Roles tools: role_update / roles.get。
// Split out of cap_roles.go to keep each file under the 350-line ceiling. owner-only。

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
)

// ───── role_update ─────────────────────────────────────────────────

func (c *rolesCapability) updateBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "role_update",
		Description: "Update an owner-curated Role. Mirrors role_create fields plus " +
			"role_id. Re-sets the prompt / corpus URIs / skills / mcp servers. " +
			"Builtin (public) role can be edited but cannot be renamed.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"role_id":{"type":"string","description":"Target role id."},
				"name":{"type":"string","description":"Role name, unique per owner."},
				"description":{"type":"string",
					"description":"Optional one-line description of when to use this role."},
				"greeting":{"type":"string",
					"description":"Greeting on visitor picker; owner's AI intro. Blank=default."},
				"prompt_id":{"type":"string",
					"description":"Optional prompt id for persona overlay."},
				"corpus_uris":{"type":"array","items":{"type":"string"},
					"description":"URI glob positive-list. raw://** always denied to visitors."},
				"skill_ids":{"type":"array","items":{"type":"string"},
					"description":"Skill ids to attach."},
				"mcp_server_ids":{"type":"array","items":{"type":"string"},
					"description":"External MCP server ids to expose."}
			},
			"required":["role_id","name"]
		}`),
		Handler: c.handleUpdate,
	}
}

type roleUpdateArgsWire struct {
	RoleID       string   `json:"role_id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Greeting     string   `json:"greeting"`
	PromptID     string   `json:"prompt_id"`
	CorpusURIs   []string `json:"corpus_uris"`
	SkillIDs     []string `json:"skill_ids"`
	MCPServerIDs []string `json:"mcp_server_ids"`
}

func (c *rolesCapability) handleUpdate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args roleUpdateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.RoleID == "" {
		return capreg.MCPError("role_id is required")
	}
	if args.Name == "" {
		return capreg.MCPError("name is required")
	}
	in := buildRoleUpdateCapInput(&args, ownerID)
	role, uerr := access.UpdateRole(ctx, *c.roles, in)
	if uerr != nil {
		return roleUpdateErrToResult(c.log, uerr)
	}
	return mcputil.MarshalResult(c.log, "role_update", roleRowToCapView(&role))
}

func buildRoleUpdateCapInput(args *roleUpdateArgsWire, ownerID string) *access.RoleWriteInput {
	in := &access.RoleWriteInput{
		OwnerID: ownerID, RoleID: args.RoleID, Name: args.Name,
		Description:  args.Description,
		Greeting:     args.Greeting,
		CorpusURIs:   mcputil.NonNilStrings(args.CorpusURIs),
		SkillIDs:     mcputil.NonNilStrings(args.SkillIDs),
		MCPServerIDs: mcputil.NonNilStrings(args.MCPServerIDs),
	}
	if args.PromptID != "" {
		p := args.PromptID
		in.PromptID = &p
	}
	return in
}

func roleUpdateErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, access.ErrRoleBuiltinImmutable) {
		return capreg.MCPError("builtin role cannot be renamed")
	}
	if errors.Is(err, access.ErrRoleNotFound) {
		return capreg.MCPError("role not found")
	}
	for _, rc := range roleCreateErrCases {
		if errors.Is(err, rc.match) {
			return capreg.MCPError(rc.msg)
		}
	}
	log.Error("cap role_update", "err", err)
	return capreg.MCPError("update role failed")
}

// ───── roles.get ───────────────────────────────────────────────────

func (c *rolesCapability) getBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "roles.get",
		Description: "Fetch one role by id (corpus URIs / skill counts / mcp counts).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"role_id":{"type":"string","description":"Role id"}
			},
			"required":["role_id"]
		}`),
		Handler: c.handleGet,
	}
}

type roleGetArgsWire struct {
	RoleID string `json:"role_id"`
}

func (c *rolesCapability) handleGet(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args roleGetArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.RoleID == "" {
		return capreg.MCPError("role_id is required")
	}
	role, err := access.GetRole(ctx, *c.roles, ownerID, args.RoleID)
	if err != nil {
		if errors.Is(err, access.ErrRoleNotFound) {
			return capreg.MCPError("role not found")
		}
		c.log.Error("cap roles.get", "err", err)
		return capreg.MCPError("get role failed")
	}
	return mcputil.MarshalResult(c.log, "roles.get", roleRowToCapView(&role))
}
