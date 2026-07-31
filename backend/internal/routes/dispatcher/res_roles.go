// res_roles.go —— 资源 roles:owner 定的"访客身份原型"。一个 role 打包了 prompt(人格)、
// corpus URI 白名单、选中的 skill、选中的外部 MCP server,外加几个 per-role 开关。
// 邀请码是发给 role 的;会话开始时冻结一份 RoleSnapshot,之后改 role 只影响新会话。
//
// 迁移前两个面差得最多的就是这个资源:admin 的 role 一直带 waypoints、dock_buttons、
// notify_owner_on_booking、require_ghost_evidence 和活跃码计数;MCP 的 role_list 只给计数,
// role_update 连那几个开关都收不了 —— 也就是说 owner 从 Claude Code **改不了、也看不见**
// require_ghost_evidence 这种安全相关的 per-role 开关。现在只有一份形状。

package dispatcher

import (
	"context"
	"encoding/json"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// RoleStore —— roles 这组操作所需的最小口。
type RoleStore interface {
	List(ctx context.Context, ownerID string) ([]Role, error)
	Get(ctx context.Context, ownerID, id string) (Role, error)
	Create(ctx context.Context, in *WriteRole) (Role, error)
	Update(ctx context.Context, in *WriteRole) (Role, error)
	Delete(ctx context.Context, ownerID, id string) error
	SetDockButtons(ctx context.Context, ownerID, id string, buttons json.RawMessage) (Role, error)
}

// Role —— 一个 role 在收口这一层的形状。
//
// Waypoints / DockButtons 用 json.RawMessage 原样透传:它们的内部结构是 access 域的事,
// 收口不需要看懂,复制一份结构定义只会多一处要跟着域演进的东西。
type Role struct {
	CreatedAt            time.Time
	UpdatedAt            time.Time
	PromptID             *string
	ID                   string
	Name                 string
	Description          string
	Greeting             string
	CorpusURIs           []string
	SkillIDs             []string
	MCPServerIDs         []string
	Waypoints            json.RawMessage
	DockButtons          json.RawMessage
	ActiveCodes          int64
	IsBuiltin            bool
	NotifyOwnerOnBooking bool
	RequireGhostEvidence bool
}

// WriteRole —— 建 / 改一个 role 的入参(ID 空 = 建)。
type WriteRole struct {
	PromptID             *string
	OwnerID              string
	ID                   string
	Name                 string
	Description          string
	Greeting             string
	CorpusURIs           []string
	SkillIDs             []string
	MCPServerIDs         []string
	Waypoints            json.RawMessage
	DockButtons          json.RawMessage
	NotifyOwnerOnBooking bool
	RequireGhostEvidence bool
}

// Roles —— roles 资源:list / get / create / update / delete / set_dock_buttons。
func Roles(store RoleStore) Resource {
	return Resource{Name: "roles", Ops: []Op{
		{
			ID: "role_list",
			Description: "List the owner's roles (incl. public builtin) with their corpus " +
				"URIs, attached skills / mcp servers, per-role switches and active code count.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      rolesList(store),
		},
		{
			ID:          "roles.get",
			Description: "Read one role in full by id.",
			InputSchema: roleIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      rolesGet(store),
		},
		{
			ID: "role_create",
			Description: "Create an owner-curated Role (visitor identity archetype). " +
				"A role bundles a Prompt (persona) + a positive-list of corpus URI globs " +
				"+ selected skills + selected MCP servers. Issue access codes against this " +
				"role; session start freezes a RoleSnapshot — edits only affect future sessions.",
			InputSchema: roleWriteSchema(roleCreateRequired),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      rolesWrite(store.Create, parseRoleCreate),
		},
		{
			ID: "role_update",
			Description: "Update an owner-curated Role. Mirrors role_create fields plus " +
				"role_id. Re-sets the prompt / corpus URIs / skills / mcp servers / " +
				"per-role switches. Builtin (public) role can be edited but not renamed.",
			InputSchema: roleWriteSchema(roleUpdateRequired),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      rolesWrite(store.Update, parseRoleUpdate),
		},
		{
			ID: "role_delete",
			Description: "Delete an owner-curated role. Public builtin cannot be deleted. " +
				"Roles in use by active codes are FK-restricted from deletion — " +
				"reassign or revoke codes first.",
			InputSchema: roleIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      rolesDelete(store),
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
			Invoke: rolesSetDockButtons(store),
		},
	}}
}

const (
	roleCreateRequired = `"name"`
	roleUpdateRequired = `"role_id","name"`
)

var roleIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"role_id":{"type":"string","description":"Role id"}},
	"required":["role_id"]
}`)

var dockButtonsSchema = json.RawMessage(`{
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
			"notify_owner_on_booking":{"type":"boolean",
				"description":"Email the owner when a visitor on this role books."},
			"require_ghost_evidence":{"type":"boolean",
				"description":"Require cited evidence before the AI answers on this role."}
		},
		"required":[` + required + `]
	}`)
}
