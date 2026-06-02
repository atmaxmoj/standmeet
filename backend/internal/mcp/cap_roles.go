// cap_roles.go —— Phase E-6: owner Roles CRUD via Capability。
// 3 tools: role_create / role_list / role_delete。owner-only。
// vanilla builtin 不可删；codes 引用的 role 也不可删 (FK 限制)。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capRolesBundle = "roles.bundle"

type rolesCapability struct {
	roles *usecases.RolesDeps
	log   *slog.Logger
}

func newRolesCapability(
	roles *usecases.RolesDeps, log *slog.Logger,
) *rolesCapability {
	return &rolesCapability{roles: roles, log: log}
}

func (*rolesCapability) ID() string               { return capRolesBundle }
func (*rolesCapability) Shape() agentskills.Shape { return agentskills.ShapeOwnerOnly }
func (*rolesCapability) VisitorBinding(
	_ context.Context, _ *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	return nil, agentskills.ErrHidden
}

func (*rolesCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (*rolesCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (c *rolesCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{
		c.createBinding(), c.listBinding(), c.deleteBinding(),
	}
}

// ───── role_create ────────────────────────────────────────────────

func (c *rolesCapability) createBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name: "role_create",
		Description: "Create an owner-curated Role (visitor identity archetype). " +
			"A role bundles a Prompt (persona) + a positive-list of corpus URI globs " +
			"+ selected skills + selected MCP servers. Issue access codes against this " +
			"role; session start freezes a RoleSnapshot — edits only affect future sessions.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"name":{"type":"string","description":"Role name, unique per owner."},
				"description":{"type":"string",
					"description":"Optional one-line description of when to use this role."},
				"prompt_id":{"type":"string",
					"description":"Optional prompt id for persona overlay."},
				"corpus_uris":{"type":"array","items":{"type":"string"},
					"description":"URI glob positive-list. raw://** always denied to visitors."},
				"skill_ids":{"type":"array","items":{"type":"string"},
					"description":"Skill ids to attach."},
				"mcp_server_ids":{"type":"array","items":{"type":"string"},
					"description":"External MCP server ids to expose."}
			},
			"required":["name"]
		}`),
		Handler: c.handleCreate,
	}
}

type roleCreateArgsWire struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	PromptID     string   `json:"prompt_id"`
	CorpusURIs   []string `json:"corpus_uris"`
	SkillIDs     []string `json:"skill_ids"`
	MCPServerIDs []string `json:"mcp_server_ids"`
}

func (c *rolesCapability) handleCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) agentskills.MCPResult {
	var args roleCreateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.Name == "" {
		return agentskills.MCPError("name is required")
	}
	in := buildRoleCreateCapInput(&args, ownerID)
	role, cerr := usecases.CreateRole(ctx, *c.roles, in)
	if cerr != nil {
		return roleCreateErrToResult(c.log, cerr)
	}
	return marshalCapResult(c.log, "role_create", map[string]string{
		"role_id": role.ID(), "name": role.Name(),
	})
}

func buildRoleCreateCapInput(args *roleCreateArgsWire, ownerID string) *usecases.RoleWriteInput {
	in := &usecases.RoleWriteInput{
		OwnerID: ownerID, Name: args.Name,
		Description:  args.Description,
		CorpusURIs:   nonNilStrings(args.CorpusURIs),
		SkillIDs:     nonNilStrings(args.SkillIDs),
		MCPServerIDs: nonNilStrings(args.MCPServerIDs),
	}
	if args.PromptID != "" {
		p := args.PromptID
		in.PromptID = &p
	}
	return in
}

var roleCreateErrCases = []struct {
	match error
	msg   string
}{
	{domain.ErrRoleNameTaken, "role name already taken"},
	{domain.ErrPromptNotFound, "prompt_id not found for this owner"},
	{domain.ErrSkillNotFound, "one or more skill_ids not found"},
	{domain.ErrMCPServerNotFound, "one or more mcp_server_ids not found"},
}

func roleCreateErrToResult(log *slog.Logger, err error) agentskills.MCPResult {
	for _, c := range roleCreateErrCases {
		if errors.Is(err, c.match) {
			return agentskills.MCPError(c.msg)
		}
	}
	log.Error("cap role_create", "err", err)
	return agentskills.MCPError("create role failed")
}

// ───── role_list ────────────────────────────────────────────────

func (c *rolesCapability) listBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name: "role_list",
		Description: "List the owner's roles (incl. vanilla builtin) " +
			"with their corpus URIs / skill counts / mcp counts.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

type roleListRow struct {
	RoleID         string   `json:"role_id"`
	Name           string   `json:"name"`
	Description    string   `json:"description,omitempty"`
	PromptID       string   `json:"prompt_id,omitempty"`
	CorpusURIs     []string `json:"corpus_uris"`
	SkillCount     int      `json:"skill_count"`
	MCPServerCount int      `json:"mcp_server_count"`
	IsBuiltin      bool     `json:"is_builtin,omitempty"`
}

func (c *rolesCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) agentskills.MCPResult {
	rows, err := usecases.ListRoles(ctx, *c.roles, ownerID)
	if err != nil {
		c.log.Error("cap role_list", "err", err)
		return agentskills.MCPError("list roles failed")
	}
	items := make([]roleListRow, 0, len(rows))
	for i := range rows {
		items = append(items, roleRowToCapView(&rows[i]))
	}
	return marshalCapResult(c.log, "role_list", items)
}

func roleRowToCapView(rl *domain.Role) roleListRow {
	row := roleListRow{
		RoleID: rl.ID(), Name: rl.Name(), Description: rl.Description(),
		CorpusURIs: rl.CorpusURIs(), SkillCount: len(rl.SkillIDs()),
		MCPServerCount: len(rl.MCPServerIDs()),
		IsBuiltin:      rl.IsBuiltin(),
	}
	if pid, ok := rl.PromptID(); ok {
		row.PromptID = pid
	}
	return row
}

// ───── role_delete ───────────────────────────────────────────────

func (c *rolesCapability) deleteBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name: "role_delete",
		Description: "Delete an owner-curated role. Vanilla builtin cannot be deleted. " +
			"Roles in use by active codes are FK-restricted from deletion — " +
			"reassign or revoke codes first.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"role_id":{"type":"string","description":"Role id"}
			},
			"required":["role_id"]
		}`),
		Handler: c.handleDelete,
	}
}

type roleDeleteArgsWire struct {
	RoleID string `json:"role_id"`
}

func (c *rolesCapability) handleDelete(
	ctx context.Context, ownerID string, raw json.RawMessage,
) agentskills.MCPResult {
	var args roleDeleteArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.RoleID == "" {
		return agentskills.MCPError("role_id is required")
	}
	if err := usecases.DeleteRole(ctx, *c.roles, ownerID, args.RoleID); err != nil {
		return roleDeleteErrToResult(c.log, err)
	}
	return marshalCapResult(c.log, "role_delete", map[string]bool{"ok": true})
}

func roleDeleteErrToResult(log *slog.Logger, err error) agentskills.MCPResult {
	if errors.Is(err, domain.ErrRoleBuiltinImmutable) {
		return agentskills.MCPError("builtin role cannot be deleted")
	}
	if errors.Is(err, domain.ErrRoleNotFound) {
		return agentskills.MCPError("role not found")
	}
	log.Error("cap role_delete", "err", err)
	return agentskills.MCPError("delete role failed (codes referencing this role?)")
}
