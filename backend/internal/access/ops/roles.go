// roles.go —— 资源 roles:owner 定的"访客身份原型"。一个 role 打包了 prompt(人格)、
// corpus URI 白名单、选中的 skill、选中的外部 MCP server,外加几个 per-role 开关。
// 邀请码是发给 role 的;会话开始时冻结一份 RoleSnapshot,之后改 role 只影响新会话。
//
// 归一化前两个面差得最多的就是这个资源:admin 的 role 一直带 waypoints、dock_buttons、
// notify_owner_on_booking、require_ghost_evidence 和活跃码计数;MCP 的 role_list 只给计数,
// role_update 连那几个开关都收不了 —— 也就是说 owner 从 Claude Code **改不了、也看不见**
// require_ghost_evidence 这种安全相关的 per-role 开关。现在只有一份形状。
//
// op 的 id 保持历史名字(role_create 而不是 roles.create)。

package ops

import (
	"context"
	"encoding/json"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// RolesDeps —— role 用例 + "dock 按钮上能挂哪些能力"。
//
// ValidCapabilityIDs 是**惰性**的:能力注册表要等插件都装完才齐,而收口在那之前就建好了。
// 存函数而不是快照,否则 dock 按钮会拿到一张空的合法能力表。
type RolesDeps struct {
	Roles              usecase.RolesDeps
	ValidCapabilityIDs func() []string
	// Extras —— 各能力在一个 role 上占的字段(calendar.book 的 notify_owner 是第一个)。
	// access 不认识任何一个能力,只认识这个口子。nil = 没有能力声明过 per-role 配置。
	Extras RoleExtras
}

// Roles —— list / get / create / update / delete / set_dock_buttons。
func Roles(d RolesDeps) []fp.Op {
	extras := extrasOr(d.Extras)
	return []fp.Op{
		{
			ID: "role_list",
			Description: "List the owner's roles (incl. public builtin) with their corpus " +
				"URIs, attached skills / mcp servers, per-role switches and active code count.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listRoles(d),
		},
		{
			ID:          "roles.get",
			Description: "Read one role in full by id.",
			InputSchema: roleIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getRole(d),
		},
		{
			ID: "role_create",
			Description: "Create an owner-curated Role (visitor identity archetype). " +
				"A role bundles a Prompt (persona) + a positive-list of corpus URI globs " +
				"+ selected skills + selected MCP servers. Issue access codes against this " +
				"role; session start freezes a RoleSnapshot — edits only affect future sessions.",
			InputSchema: withExtraFields(roleWriteSchema(roleCreateRequired), extras.Fields()),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writeRole(d, extras, usecase.CreateRole, decodeRoleCreate),
		},
		{
			ID: "role_update",
			Description: "Update an owner-curated Role. Mirrors role_create fields plus " +
				"role_id. Re-sets the prompt / corpus URIs / skills / mcp servers / " +
				"per-role switches. Builtin (public) role can be edited but not renamed.",
			InputSchema: withExtraFields(roleWriteSchema(roleUpdateRequired), extras.Fields()),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writeRole(d, extras, usecase.UpdateRole, decodeRoleUpdate),
		},
		{
			ID: "role_delete",
			Description: "Delete an owner-curated role. Public builtin cannot be deleted. " +
				"Roles in use by active codes are FK-restricted from deletion — " +
				"reassign or revoke codes first.",
			InputSchema: roleIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteRole(d.Roles),
		},
		{
			ID: "roles.set_dock_buttons",
			Description: "Set a role's chat dock buttons (#109/#110): at most two " +
				"{capability_id, trigger}. Clicking a button sends its trigger phrase as the " +
				"visitor's message. capability_id must be a visitor-facing capability this " +
				"instance exposes; trigger must be non-empty.",
			InputSchema: dockButtonsSchema,
			Kind:        fp.Action,
			Reach: fp.Only(
				"chat-dock UI hint; on admin it is folded into the role update body", "mcp",
			),
			Invoke: setRoleDockButtons(d),
		},
	}
}

const (
	roleCreateRequired = `"name"`
	roleUpdateRequired = `"role_id","name"`
)

var (
	roleIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"role_id":{"type":"string","description":"Role id"}},
		"required":["role_id"]
	}`)

	dockButtonsSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"role_id":{"type":"string","description":"Target role id."},
			"buttons":{"type":"array","maxItems":2,
				"description":"Up to two dock buttons.",
				"items":{"type":"object",
					"properties":{"capability_id":{"type":"string"},"trigger":{"type":"string"}},
					"required":["capability_id","trigger"]}}
		},
		"required":["role_id","buttons"]
	}`)
)

func roleWriteSchema(required string) json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"role_id":{"type":"string","description":"Target role id (update only)."},
			"name":{"type":"string","description":"Role name, unique per owner."},
			"description":{"type":"string",
				"description":"Optional one-line description of when to use this role."},
			"greeting":{"type":"string",
				"description":"Greeting on visitor picker; owner's AI intro. Blank=default."},
			"prompt_id":{"type":"string","description":"Optional prompt id for persona overlay."},
			"corpus_uris":{"type":"array","items":{"type":"string"},
				"description":"URI glob positive-list. raw://** always denied to visitors."},
			"skill_ids":{"type":"array","items":{"type":"string"},
				"description":"Skill ids to attach."},
			"mcp_server_ids":{"type":"array","items":{"type":"string"},
				"description":"External MCP server ids to expose."},
			"waypoints":{"type":"array","items":{"type":"object"},
				"description":"Ghost-steering destinations for this role."},
			"dock_buttons":{"type":"array","maxItems":2,"items":{"type":"object"},
				"description":"Up to two chat dock buttons {capability_id, trigger}."},
			"require_ghost_evidence":{"type":"boolean",
				"description":"Require cited evidence before the AI answers on this role."}
		},
		"required":[` + required + `]
	}`)
}

// roleOut —— 出站载荷形状(每个面同一份;admin 已发出去的契约就是它)。
type roleOut struct {
	CreatedAt            string                    `json:"created_at"`
	UpdatedAt            string                    `json:"updated_at"`
	PromptID             *string                   `json:"prompt_id,omitempty"`
	ID                   string                    `json:"id"`
	Name                 string                    `json:"name"`
	Description          string                    `json:"description"`
	Greeting             string                    `json:"greeting"`
	CorpusURIs           []string                  `json:"corpus_uris"`
	SkillIDs             []string                  `json:"skill_ids"`
	MCPServerIDs         []string                  `json:"mcp_server_ids"`
	Waypoints            []entity.Waypoint         `json:"waypoints"`
	DockButtons          []entity.DockButtonConfig `json:"dock_buttons"`
	ActiveCodes          int64                     `json:"active_codes"`
	IsBuiltin            bool                      `json:"is_builtin"`
	RequireGhostEvidence bool                      `json:"require_ghost_evidence"`
}

// marshalRole —— 出站载荷 = 本域的形状 + 各能力在这个 role 上那几个字段的值。
//
// 跟 marshalCode 是同一件事的另一个主体。能力的值是**并进来**的,不是本结构体的字段 ——
// access 不认识它们叫什么,所以它们不能出现在 roleOut 上。notify_owner_on_booking 以前
// 就在那上面,而且一路长到了内核的 roles 表。
func marshalRole(
	ctx context.Context, deps usecase.RolesDeps, extras SubjectExtras, rl *entity.Role,
) (json.RawMessage, error) {
	row, err := json.Marshal(toRoleOut(ctx, deps, rl))
	if err != nil {
		return nil, fp.OpErr("encode role", err)
	}
	return withExtraValues(row, extras.Read(ctx, rl.ID())), nil
}

// toRoleOut —— 域实体 → 出站形状,顺带补上活跃码计数。计数失败不该让整条读操作失败
// (它是展示用的旁证),记 0 并继续 —— admin 面一直是这个行为。
func toRoleOut(ctx context.Context, deps usecase.RolesDeps, rl *entity.Role) roleOut {
	count, cerr := usecase.CountActiveCodesForRole(ctx, deps, rl.OwnerID(), rl.ID())
	if cerr != nil {
		count = 0
	}
	out := roleOut{
		ID: rl.ID(), Name: rl.Name(), Description: rl.Description(),
		Greeting: rl.Greeting(), CorpusURIs: nonNilStrings(rl.CorpusURIs()),
		SkillIDs: nonNilStrings(rl.SkillIDs()), MCPServerIDs: nonNilStrings(rl.MCPServerIDs()),
		ActiveCodes: count, IsBuiltin: rl.IsBuiltin(),
		RequireGhostEvidence: rl.RequireGhostEvidence(),
		CreatedAt:            rl.CreatedAt().UTC().Format(time.RFC3339),
		UpdatedAt:            rl.UpdatedAt().UTC().Format(time.RFC3339),
		Waypoints:            nonNilWaypoints(rl.Waypoints()),
		DockButtons:          nonNilDockButtons(rl.DockButtons()),
	}
	if pid, ok := rl.PromptID(); ok {
		out.PromptID = &pid
	}
	return out
}

func nonNilDockButtons(in []entity.DockButtonConfig) []entity.DockButtonConfig {
	if in == nil {
		return []entity.DockButtonConfig{}
	}
	return in
}

func listRoles(d RolesDeps) fp.Invoke {
	extras := extrasOr(d.Extras)
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListRoles(ctx, d.Roles, ownerID)
		if err != nil {
			return nil, roleErr(err)
		}
		out := make([]json.RawMessage, 0, len(rows))
		for i := range rows {
			row, merr := marshalRole(ctx, d.Roles, extras, &rows[i])
			if merr != nil {
				return nil, merr
			}
			out = append(out, row)
		}
		return json.Marshal(out)
	}
}

type roleIDArgs struct {
	RoleID string `json:"role_id"`
}

func parseRoleID(raw json.RawMessage) (string, error) {
	var in roleIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.RoleID, fp.RequireArgs([2]string{"role_id", in.RoleID})
}

func getRole(d RolesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseRoleID(raw)
		if perr != nil {
			return nil, perr
		}
		rl, err := usecase.GetRole(ctx, d.Roles, ownerID, id)
		if err != nil {
			return nil, roleErr(err)
		}
		return marshalRole(ctx, d.Roles, extrasOr(d.Extras), &rl)
	}
}

func deleteRole(deps usecase.RolesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseRoleID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.DeleteRole(ctx, deps, ownerID, id); err != nil {
			return nil, roleDeleteErr(err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

type dockButtonsArgs struct {
	RoleID  string                    `json:"role_id"`
	Buttons []entity.DockButtonConfig `json:"buttons"`
}

func setRoleDockButtons(d RolesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in dockButtonsArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("dock_buttons must be an array of {capability_id, trigger}")
		}
		if err := fp.RequireArgs([2]string{"role_id", in.RoleID}); err != nil {
			return nil, err
		}
		rl, err := usecase.SetRoleDockButtons(ctx, d.Roles, &usecase.SetDockButtonsInput{
			OwnerID: ownerID, RoleID: in.RoleID, Buttons: nonNilDockButtons(in.Buttons),
			ValidCapabilityIDs: d.ValidCapabilityIDs(),
		})
		if err != nil {
			return nil, roleErr(err)
		}
		return marshalRole(ctx, d.Roles, extrasOr(d.Extras), &rl)
	}
}
