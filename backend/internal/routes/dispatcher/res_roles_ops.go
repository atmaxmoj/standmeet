// res_roles_ops.go —— roles 资源的解参 / 调用 / 序列化(声明在 res_roles.go)。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// roleRow —— 出站载荷形状(两个面同一份;admin 已发出去的契约就是它)。
type roleRow struct {
	CreatedAt            string          `json:"created_at"`
	UpdatedAt            string          `json:"updated_at"`
	PromptID             *string         `json:"prompt_id,omitempty"`
	ID                   string          `json:"id"`
	Name                 string          `json:"name"`
	Description          string          `json:"description"`
	Greeting             string          `json:"greeting"`
	CorpusURIs           []string        `json:"corpus_uris"`
	SkillIDs             []string        `json:"skill_ids"`
	MCPServerIDs         []string        `json:"mcp_server_ids"`
	Waypoints            json.RawMessage `json:"waypoints"`
	DockButtons          json.RawMessage `json:"dock_buttons"`
	ActiveCodes          int64           `json:"active_codes"`
	IsBuiltin            bool            `json:"is_builtin"`
	NotifyOwnerOnBooking bool            `json:"notify_owner_on_booking"`
	RequireGhostEvidence bool            `json:"require_ghost_evidence"`
}

// emptyJSONArray —— nil 的列表字段出站要是 [] 而不是 null(项目原则:容器永不为 nil)。
func emptyJSONArray(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`[]`)
	}
	return raw
}

func toRoleRow(rl *Role) roleRow {
	return roleRow{
		ID: rl.ID, Name: rl.Name, Description: rl.Description, Greeting: rl.Greeting,
		PromptID: rl.PromptID, CorpusURIs: rl.CorpusURIs, SkillIDs: rl.SkillIDs,
		MCPServerIDs: rl.MCPServerIDs,
		Waypoints:    emptyJSONArray(rl.Waypoints), DockButtons: emptyJSONArray(rl.DockButtons),
		ActiveCodes: rl.ActiveCodes, IsBuiltin: rl.IsBuiltin,
		NotifyOwnerOnBooking: rl.NotifyOwnerOnBooking,
		RequireGhostEvidence: rl.RequireGhostEvidence,
		CreatedAt:            rl.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:            rl.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func rolesList(store RoleStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("list roles: %w", err)
		}
		out := make([]roleRow, 0, len(rows))
		for i := range rows {
			out = append(out, toRoleRow(&rows[i]))
		}
		return marshalOut(out)
	}
}

type roleIDArgs struct {
	RoleID string `json:"role_id"`
}

func parseRoleID(raw json.RawMessage) (string, error) {
	var in roleIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", BadInput("invalid arguments: " + err.Error())
	}
	if in.RoleID == "" {
		return "", BadInput("role_id is required")
	}
	return in.RoleID, nil
}

func rolesGet(store RoleStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseRoleID(raw)
		if perr != nil {
			return nil, perr
		}
		rl, err := store.Get(ctx, ownerID, id)
		if err != nil {
			return nil, fmt.Errorf("get role: %w", err)
		}
		row := toRoleRow(&rl)
		return marshalOut(row)
	}
}

type roleWriteArgs struct {
	PromptID             *string         `json:"prompt_id"`
	RoleID               string          `json:"role_id"`
	Name                 string          `json:"name"`
	Description          string          `json:"description"`
	Greeting             string          `json:"greeting"`
	CorpusURIs           []string        `json:"corpus_uris"`
	SkillIDs             []string        `json:"skill_ids"`
	MCPServerIDs         []string        `json:"mcp_server_ids"`
	Waypoints            json.RawMessage `json:"waypoints"`
	DockButtons          json.RawMessage `json:"dock_buttons"`
	NotifyOwnerOnBooking bool            `json:"notify_owner_on_booking"`
	RequireGhostEvidence bool            `json:"require_ghost_evidence"`
}

func parseRoleCreate(raw json.RawMessage) (roleWriteArgs, error) {
	var in roleWriteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, BadInput("invalid arguments: " + err.Error())
	}
	if in.Name == "" {
		return in, BadInput("name is required")
	}
	return in, nil
}

// parseRoleUpdate —— 跟 create 一样,外加必填的 role_id。
func parseRoleUpdate(raw json.RawMessage) (roleWriteArgs, error) {
	in, err := parseRoleCreate(raw)
	if err != nil {
		return in, err
	}
	if in.RoleID == "" {
		return in, BadInput("role_id is required")
	}
	return in, nil
}

// nonNilStrings —— 字符串列表不该是 nil(空列表和"没给"在域那边是同一回事)。
func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func rolesWrite(
	apply func(ctx context.Context, in *WriteRole) (Role, error),
	parse func(json.RawMessage) (roleWriteArgs, error),
) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parse(raw)
		if perr != nil {
			return nil, perr
		}
		rl, err := apply(ctx, toWriteRole(ownerID, &in))
		if err != nil {
			return nil, fmt.Errorf("write role: %w", err)
		}
		row := toRoleRow(&rl)
		return marshalOut(row)
	}
}

func toWriteRole(ownerID string, in *roleWriteArgs) *WriteRole {
	return &WriteRole{
		OwnerID: ownerID, ID: in.RoleID, Name: in.Name, Description: in.Description,
		Greeting: in.Greeting, PromptID: in.PromptID,
		CorpusURIs:   nonNilStrings(in.CorpusURIs),
		SkillIDs:     nonNilStrings(in.SkillIDs),
		MCPServerIDs: nonNilStrings(in.MCPServerIDs),
		Waypoints:    in.Waypoints, DockButtons: in.DockButtons,
		NotifyOwnerOnBooking: in.NotifyOwnerOnBooking,
		RequireGhostEvidence: in.RequireGhostEvidence,
	}
}

func rolesDelete(store RoleStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseRoleID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := store.Delete(ctx, ownerID, id); err != nil {
			return nil, fmt.Errorf("delete role: %w", err)
		}
		return marshalOut(map[string]bool{"ok": true})
	}
}

type dockButtonsArgs struct {
	RoleID  string          `json:"role_id"`
	Buttons json.RawMessage `json:"buttons"`
}

func rolesSetDockButtons(store RoleStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in dockButtonsArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.RoleID == "" {
			return nil, BadInput("role_id is required")
		}
		rl, err := store.SetDockButtons(ctx, ownerID, in.RoleID, in.Buttons)
		if err != nil {
			return nil, fmt.Errorf("set dock buttons: %w", err)
		}
		row := toRoleRow(&rl)
		return marshalOut(row)
	}
}
