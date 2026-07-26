// cap_roles.go —— Phase E-6: owner Roles CRUD via Capability。
// 3 tools: role_create / role_list / role_delete。owner-only。
// public builtin 不可删；codes 引用的 role 也不可删 (FK 限制)。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capRolesBundle = "roles.bundle"

type rolesCapability struct {
	roles *usecases.RolesDeps
	// capIDs —— dock 按钮可挂的能力 id 集（访客侧、非 owner-only）。lazy 闭包读注册表，
	// 调用时（handler 期）注册表已装满。#109/#110 set_dock_buttons 校验 cap 有效性用。
	capIDs func() []string
	log    *slog.Logger
}

func newRolesCapability(
	roles *usecases.RolesDeps, capIDs func() []string, log *slog.Logger,
) *rolesCapability {
	return &rolesCapability{roles: roles, capIDs: capIDs, log: log}
}

func (*rolesCapability) ID() string          { return capRolesBundle }
func (*rolesCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*rolesCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*rolesCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*rolesCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *rolesCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.createBinding(), c.listBinding(), c.deleteBinding(), c.setDockButtonsBinding(),
		c.updateBinding(), c.getBinding(),
	}
}

// ───── roles.set_dock_buttons ──────────────────────────────────────

func (c *rolesCapability) setDockButtonsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "roles.set_dock_buttons",
		Description: "Set a role's chat dock buttons (#109/#110): at most two " +
			"{capability_id, trigger}. Clicking a button sends its trigger phrase as the " +
			"visitor's message. capability_id must be a visitor-facing capability this " +
			"instance exposes; trigger must be non-empty. Same validation as the admin UI.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"role_id":{"type":"string","description":"Target role id."},
				"buttons":{"type":"array","maxItems":2,
					"description":"Up to two dock buttons.",
					"items":{"type":"object",
						"properties":{
							"capability_id":{"type":"string"},
							"trigger":{"type":"string"}
						},
						"required":["capability_id","trigger"]}}
			},
			"required":["role_id","buttons"]
		}`),
		Handler: c.handleSetDockButtons,
	}
}

type setDockButtonsArgsWire struct {
	RoleID  string                    `json:"role_id"`
	Buttons []domain.DockButtonConfig `json:"buttons"`
}

func (c *rolesCapability) handleSetDockButtons(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args setDockButtonsArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.RoleID == "" {
		return capreg.MCPError("role_id is required")
	}
	role, err := usecases.SetRoleDockButtons(ctx, *c.roles, &usecases.SetDockButtonsInput{
		OwnerID: ownerID, RoleID: args.RoleID, Buttons: args.Buttons,
		ValidCapabilityIDs: c.capIDs(),
	})
	if err != nil {
		return dockButtonsErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "roles.set_dock_buttons", map[string]any{
		"role_id": role.ID(), "dock_buttons": role.DockButtons(),
	})
}

var dockButtonErrMessages = []struct {
	err error
	msg string
}{
	{domain.ErrTooManyDockButtons, "at most two dock buttons"},
	{domain.ErrDockButtonEmptyTrigger, "dock button needs a non-empty trigger"},
	{domain.ErrUnknownDockCapability, "dock button capability not available"},
	{domain.ErrRoleNotFound, "role not found"},
}

func dockButtonsErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	for i := range dockButtonErrMessages {
		if errors.Is(err, dockButtonErrMessages[i].err) {
			return capreg.MCPError(dockButtonErrMessages[i].msg)
		}
	}
	log.Error("cap roles.set_dock_buttons", "err", err)
	return capreg.MCPError("set dock buttons failed")
}

// ───── role_create ────────────────────────────────────────────────

func (c *rolesCapability) createBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
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
			"required":["name"]
		}`),
		Handler: c.handleCreate,
	}
}

type roleCreateArgsWire struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Greeting     string   `json:"greeting"`
	PromptID     string   `json:"prompt_id"`
	CorpusURIs   []string `json:"corpus_uris"`
	SkillIDs     []string `json:"skill_ids"`
	MCPServerIDs []string `json:"mcp_server_ids"`
}

func (c *rolesCapability) handleCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args roleCreateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.Name == "" {
		return capreg.MCPError("name is required")
	}
	in := buildRoleCreateCapInput(&args, ownerID)
	role, cerr := usecases.CreateRole(ctx, *c.roles, in)
	if cerr != nil {
		return roleCreateErrToResult(c.log, cerr)
	}
	return mcputil.MarshalResult(c.log, "role_create", map[string]string{
		"role_id": role.ID(), "name": role.Name(),
	})
}

func buildRoleCreateCapInput(args *roleCreateArgsWire, ownerID string) *usecases.RoleWriteInput {
	in := &usecases.RoleWriteInput{
		OwnerID: ownerID, Name: args.Name,
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

var roleCreateErrCases = []struct {
	match error
	msg   string
}{
	{domain.ErrRoleNameTaken, "role name already taken"},
	{domain.ErrPromptNotFound, "prompt_id not found for this owner"},
	{marketplace.ErrSkillNotFound, "one or more skill_ids not found"},
	{marketplace.ErrMCPServerNotFound, "one or more mcp_server_ids not found"},
}

func roleCreateErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	for _, c := range roleCreateErrCases {
		if errors.Is(err, c.match) {
			return capreg.MCPError(c.msg)
		}
	}
	log.Error("cap role_create", "err", err)
	return capreg.MCPError("create role failed")
}

// ───── role_list ────────────────────────────────────────────────

func (c *rolesCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "role_list",
		Description: "List the owner's roles (incl. public builtin) " +
			"with their corpus URIs / skill counts / mcp counts.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

type roleListRow struct {
	RoleID         string   `json:"role_id"`
	Name           string   `json:"name"`
	Description    string   `json:"description,omitempty"`
	Greeting       string   `json:"greeting,omitempty"`
	PromptID       string   `json:"prompt_id,omitempty"`
	CorpusURIs     []string `json:"corpus_uris"`
	SkillCount     int      `json:"skill_count"`
	MCPServerCount int      `json:"mcp_server_count"`
	IsBuiltin      bool     `json:"is_builtin,omitempty"`
}

func (c *rolesCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	rows, err := usecases.ListRoles(ctx, *c.roles, ownerID)
	if err != nil {
		c.log.Error("cap role_list", "err", err)
		return capreg.MCPError("list roles failed")
	}
	items := make([]roleListRow, 0, len(rows))
	for i := range rows {
		items = append(items, roleRowToCapView(&rows[i]))
	}
	return mcputil.MarshalResult(c.log, "role_list", items)
}

func roleRowToCapView(rl *domain.Role) roleListRow {
	row := roleListRow{
		RoleID: rl.ID(), Name: rl.Name(), Description: rl.Description(),
		Greeting:   rl.Greeting(),
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

func (c *rolesCapability) deleteBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "role_delete",
		Description: "Delete an owner-curated role. Public builtin cannot be deleted. " +
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
) capreg.MCPResult {
	var args roleDeleteArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.RoleID == "" {
		return capreg.MCPError("role_id is required")
	}
	if err := usecases.DeleteRole(ctx, *c.roles, ownerID, args.RoleID); err != nil {
		return roleDeleteErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "role_delete", map[string]bool{"ok": true})
}

func roleDeleteErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, domain.ErrRoleBuiltinImmutable) {
		return capreg.MCPError("builtin role cannot be deleted")
	}
	if errors.Is(err, domain.ErrRoleNotFound) {
		return capreg.MCPError("role not found")
	}
	log.Error("cap role_delete", "err", err)
	return capreg.MCPError("delete role failed (codes referencing this role?)")
}
