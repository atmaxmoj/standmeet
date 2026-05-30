// tools_roles.go —— role_create / role_list / role_delete MCP tools。
// owner 通过 Claude Desktop 管 visitor 身份原型；vanilla 不可删（usecase 拦）。
//
// role_create 接 corpus_uris (URI glob 白名单)、skill_ids、mcp_server_ids
// 一次性配置 join 表。所有 join 项必须属于同 owner（usecase validateRoleJoinOwnership）。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

func rolesTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(roleCreateTool(), wrapTool(invokeRoleCreate(deps)))
	srv.AddTool(roleListTool(), wrapTool(invokeRoleList(deps)))
	srv.AddTool(roleDeleteTool(), wrapTool(invokeRoleDelete(deps)))
}

func roleCreateTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"role_create",
		mcpgo.WithDescription("Create an owner-curated Role (visitor identity archetype). "+
			"A role bundles a Prompt (persona) + a positive-list of corpus URI globs "+
			"(e.g. 'wiki://thinking/**', 'output://public/**') + selected skills + selected "+
			"MCP servers. Issue access codes against this role; session start freezes "+
			"a RoleSnapshot — editing the role later only affects future sessions."),
		mcpgo.WithString("name", mcpgo.Required(),
			mcpgo.Description("Role name, unique per owner (e.g. 'recruiter-default').")),
		mcpgo.WithString("description",
			mcpgo.Description("Optional one-line description of when to use this role.")),
		mcpgo.WithString("prompt_id",
			mcpgo.Description("Optional prompt id (from prompt_list / prompt_create) for "+
				"persona overlay. Empty = no persona.")),
		mcpgo.WithArray("corpus_uris",
			mcpgo.Description("URI glob positive-list (e.g. ['wiki://**','output://public/**']). "+
				"raw://** is always denied to visitors regardless of this list. Empty = "+
				"deny all corpus visibility for this role.")),
		mcpgo.WithArray("skill_ids",
			mcpgo.Description("Skill ids to attach; visitor sessions snapshot the prompts.")),
		mcpgo.WithArray("mcp_server_ids",
			mcpgo.Description("External MCP server ids to expose to visitor agent.")),
	)
}

func invokeRoleCreate(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		name, err := req.RequireString("name")
		if err != nil {
			return mcpgo.NewToolResultError("name is required")
		}
		in := buildRoleCreateInput(req, ownerID, name)
		role, cerr := usecases.CreateRole(ctx, deps.Roles, in)
		if cerr != nil {
			return mapRoleCreateErr(deps, cerr)
		}
		return marshalResult(deps, roleIDPayload{RoleID: role.ID(), Name: role.Name()})
	}
}

func buildRoleCreateInput(
	req *mcpgo.CallToolRequest, ownerID, name string,
) *usecases.RoleWriteInput {
	promptID := req.GetString("prompt_id", "")
	in := &usecases.RoleWriteInput{
		OwnerID: ownerID, Name: name,
		Description:  req.GetString("description", ""),
		CorpusURIs:   getStringArray(req, "corpus_uris"),
		SkillIDs:     getStringArray(req, "skill_ids"),
		MCPServerIDs: getStringArray(req, "mcp_server_ids"),
	}
	if promptID != "" {
		in.PromptID = &promptID
	}
	return in
}

// roleCreateErrMap —— Role create 的 sentinel → 用户友好消息表，提
// 出来让 mapRoleCreateErr cyclo ≤ 2。
var roleCreateErrMap = []struct {
	match error
	msg   string
}{
	{domain.ErrRoleNameTaken, "role name already taken"},
	{domain.ErrPromptNotFound, "prompt_id not found for this owner"},
	{domain.ErrSkillNotFound, "one or more skill_ids not found"},
	{domain.ErrMCPServerNotFound, "one or more mcp_server_ids not found"},
}

func mapRoleCreateErr(deps *Deps, err error) *mcpgo.CallToolResult {
	for _, c := range roleCreateErrMap {
		if errors.Is(err, c.match) {
			return mcpgo.NewToolResultError(c.msg)
		}
	}
	deps.Log.Error("mcp role_create", "err", err)
	return mcpgo.NewToolResultError("create role failed")
}

func roleListTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"role_list",
		mcpgo.WithDescription("List the owner's roles (incl. vanilla builtin) "+
			"with their corpus URIs / skill counts / mcp counts."),
	)
}

func invokeRoleList(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		rows, err := usecases.ListRoles(ctx, deps.Roles, ownerID)
		if err != nil {
			deps.Log.Error("mcp role_list", "err", err)
			return mcpgo.NewToolResultError("list roles failed")
		}
		items := make(roleRows, 0, len(rows))
		for i := range rows {
			items = append(items, toRoleRowPayload(&rows[i]))
		}
		return marshalResult(deps, items)
	}
}

func toRoleRowPayload(rl *domain.Role) roleRowPayload {
	row := roleRowPayload{
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

func roleDeleteTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"role_delete",
		mcpgo.WithDescription("Delete an owner-curated role. Vanilla builtin cannot be "+
			"deleted. Roles in use by active codes are FK-restricted from deletion — "+
			"reassign or revoke codes first."),
		mcpgo.WithString("role_id", mcpgo.Required(),
			mcpgo.Description("Role id returned by role_create / role_list.")),
	)
}

func invokeRoleDelete(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		roleID, err := req.RequireString("role_id")
		if err != nil {
			return mcpgo.NewToolResultError("role_id is required")
		}
		derr := usecases.DeleteRole(ctx, deps.Roles, ownerID, roleID)
		if derr != nil {
			return mapRoleDeleteErr(deps, derr)
		}
		return mcpgo.NewToolResultText(`{"ok":true}`)
	}
}

func mapRoleDeleteErr(deps *Deps, err error) *mcpgo.CallToolResult {
	switch {
	case errors.Is(err, domain.ErrRoleBuiltinImmutable):
		return mcpgo.NewToolResultError("builtin role cannot be deleted")
	case errors.Is(err, domain.ErrRoleNotFound):
		return mcpgo.NewToolResultError("role not found")
	default:
		deps.Log.Error("mcp role_delete", "err", err)
		return mcpgo.NewToolResultError("delete role failed (codes referencing this role?)")
	}
}

// getStringArray —— scripts/skills/mcp arrays 来自 MCP client JSON。安全
// 兜底：缺失或类型不对返空切片，调用方按"未提供"对待。
func getStringArray(req *mcpgo.CallToolRequest, key string) []string {
	arr, ok := getAnyArray(req, key)
	if !ok {
		return []string{}
	}
	return filterStrings(arr)
}

func getAnyArray(req *mcpgo.CallToolRequest, key string) ([]any, bool) {
	raw, ok := req.GetArguments()[key]
	if !ok || raw == nil {
		return []any{}, false
	}
	arr, ok := raw.([]any)
	if !ok {
		return []any{}, false
	}
	return arr, true
}

func filterStrings(arr []any) []string {
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, isStr := item.(string); isStr {
			out = append(out, s)
		}
	}
	return out
}

type roleIDPayload struct {
	RoleID string `json:"role_id"`
	Name   string `json:"name"`
}

func (p roleIDPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal role id payload: %w", err)
	}
	return b, nil
}

type roleRowPayload struct {
	RoleID         string   `json:"role_id"`
	Name           string   `json:"name"`
	Description    string   `json:"description,omitempty"`
	PromptID       string   `json:"prompt_id,omitempty"`
	CorpusURIs     []string `json:"corpus_uris"`
	SkillCount     int      `json:"skill_count"`
	MCPServerCount int      `json:"mcp_server_count"`
	IsBuiltin      bool     `json:"is_builtin,omitempty"`
}

type roleRows []roleRowPayload

func (rs roleRows) marshalJSON() ([]byte, error) {
	b, err := json.Marshal([]roleRowPayload(rs))
	if err != nil {
		return nil, fmt.Errorf("marshal role rows: %w", err)
	}
	return b, nil
}
