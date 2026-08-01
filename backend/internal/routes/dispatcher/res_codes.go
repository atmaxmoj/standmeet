// res_codes.go —— 资源 codes:owner 发出去的邀请码。
//
// 一张码 = 一个访客身份的入口:它指向一个 role(人格 + 语料范围 + 能力),再叠上这张码自己的
// 配额(几个人、每会话几轮)、per-code 的 ACL 收窄(拒某个能力 / skill / 语料 URI)、
// 引导目的地(waypoints),以及要不要强制引用证据。
//
// 迁移时发现的三处:
//
//   - MCP 的 codes.list 少了 require_ghost_evidence 和 prompt_id —— owner 从 Claude Code
//     看不出这张码有没有强制引用证据(那是个安全相关的开关,跟 role 上那个同类)。
//   - `/codes/{id}/waypoints`、`/codes/{id}/corpus`、`/codes/{id}/ghost-evidence` 三条
//     admin 路由**在手写台账里一行都没有** —— 既没有 MCP 孪生,也没被登记,棘轮从来看不见
//     它们。声明成 op 之后,两个面都欠它们。
//   - max_bookings 是 booker 的数据(它自管的 per-code 配额),不是码本身的字段。
//     暂时仍随码一起读写,见 CodeQuotaStore 的说明。

package dispatcher

import (
	"context"
	"encoding/json"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// emptyArgsSchema / formatOptionalTime —— **迁移期**的两个共用件,还没搬进域的那几个资源
// 在用。它们放在这个已经进了 check-boundary-thin 基线的文件里,是为了跟着最后一个资源一起
// 消失 —— 谁搬走 codes,谁就得把它们一并处理,门会逼着做。
var emptyArgsSchema = json.RawMessage(`{"type":"object","properties":{}}`)

// formatOptionalTime —— nil 保持 null(调用方据此显示"没有")。
func formatOptionalTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

// CodeStore —— 码本身的读写(ACL 面在 CodeACLStore:一张码的**身份**和它的**权限收窄**
// 是两件事,接口也分开 —— 挤成一个 11 方法的口子,读的人就看不出这条线在哪)。
type CodeStore interface {
	List(ctx context.Context, ownerID string) ([]Code, error)
	Create(ctx context.Context, in *CreateCode) (Code, error)
	Revoke(ctx context.Context, ownerID, codeID string) error
	UpdateQuotas(ctx context.Context, in *UpdateCodeQuotas) (Code, error)
	SetGhostEvidence(ctx context.Context, ownerID, codeID string, require *bool) (Code, error)
	Members(ctx context.Context, ownerID, codeID string) ([]CodeMember, error)
}

// Codes —— codes 资源:码本身 + 它的 ACL 面。
func Codes(store CodeStore, acl CodeACLStore) Resource {
	return Resource{Name: "codes", Ops: append(codeCoreOps(store), codeACLOps(acl)...)}
}

func codeCoreOps(store CodeStore) []Op {
	return []Op{
		{
			ID: "codes.list",
			Description: "List the owner's access codes with their role, quotas, per-code " +
				"switches and attached ghosts.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      codesList(store),
		},
		{
			ID: "codes.create",
			Description: "Issue an access code against a role. The role decides persona, " +
				"corpus scope and capabilities; the code adds its own quotas.",
			InputSchema: codeCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      codesCreate(store),
		},
		{
			ID:          "codes.revoke",
			Description: "Revoke an access code. Existing sessions keep their frozen snapshot.",
			InputSchema: codeIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      codesRevoke(store),
		},
		{
			ID:          "codes.update_quotas",
			Description: "Change a code's quotas (members, turns per session, bookings).",
			InputSchema: codeQuotaSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      codesUpdateQuotas(store),
		},
		{
			ID: "codes.set_ghost_evidence",
			Description: "Require (or stop requiring) cited evidence before the AI answers " +
				"on this code. null clears the per-code override and inherits the role's.",
			InputSchema: codeGhostSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      codesSetGhostEvidence(store),
		},
		{
			ID:          "codes.list_members",
			Description: "List the visitors who have claimed this code.",
			InputSchema: codeIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      codesMembers(store),
		},
	}
}

var codeIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"code_id":{"type":"string","description":"Access code id."}},
	"required":["code_id"]
}`)

var codeCreateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"code":{"type":"string",
			"description":"The code string. Omit to derive one from the label (LABEL-XXX)."},
		"label":{"type":"string","description":"Who / what this code is for."},
		"purpose":{"type":"string","description":"Optional purpose tag."},
		"assumed_role_id":{"type":"string",
			"description":"Role this code assumes. Omit to use the owner's public role."},
		"ghosts":{"type":"array","items":{"type":"string"},
			"description":"Suggested questions shown to the visitor."},
		"prompt_id":{"type":"string","description":"Per-code prompt override."},
		"max_members":{"type":"integer","description":"How many visitors may claim it."},
		"max_turns_per_session":{"type":"integer","description":"Turn cap per session."},
		"max_bookings":{"type":"integer","description":"Booking cap (booker's own quota)."},
		"expires_at":{"type":"string","description":"RFC3339 expiry; empty = never."}
	},
	"required":[]
}`)

var codeQuotaSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"code_id":{"type":"string","description":"Access code id."},
		"max_members":{"type":["integer","null"],
			"description":"Omit to leave unchanged; null means no limit."},
		"max_turns_per_session":{"type":["integer","null"],
			"description":"Omit to leave unchanged; null means no limit."},
		"max_bookings":{"type":["integer","null"],
			"description":"Omit to leave unchanged; null means no limit."}
	},
	"required":["code_id"]
}`)

var codeGhostSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"code_id":{"type":"string","description":"Access code id."},
		"require_ghost_evidence":{"type":["boolean","null"],
			"description":"true / false, or null to inherit the role's setting."}
	},
	"required":["code_id"]
}`)

// Code —— 一张码在收口这一层的形状。
type Code struct {
	ExpiresAt            *time.Time
	MaxMembers           *int32
	MaxTurnsPerSession   *int32
	MaxBookings          *int32
	RequireGhostEvidence *bool
	PromptID             *string
	CreatedAt            time.Time
	ID                   string
	Code                 string
	Label                string
	Status               string
	AssumedRoleID        string
	Ghosts               []string
}

// CreateCode / UpdateCodeQuotas —— 写入参。
// AssumedRoleID 可以空:适配器兜到 owner 的 public role。
type CreateCode struct {
	ExpiresAt          *time.Time
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	MaxBookings        *int32
	PromptID           *string
	OwnerID            string
	Code               string
	Label              string
	Purpose            string
	AssumedRoleID      string
	Ghosts             []string
}

// UpdateCodeQuotas —— 改配额。每个字段是三态的,见 OptionalInt32。
type UpdateCodeQuotas struct {
	MaxMembers         OptionalInt32
	MaxTurnsPerSession OptionalInt32
	MaxBookings        OptionalInt32
	OwnerID            string
	CodeID             string
}

// CodeMember —— 认领了这张码的一个访客。形状跟两个面已经发出去的那份一致
// (display_name / is_anonymous,不是我另起一套)。
type CodeMember struct {
	LastSeenAt  *time.Time
	ID          string
	DisplayName string
	Email       string
	IsAnonymous bool
}
