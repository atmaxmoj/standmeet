// codes.go —— 资源 codes:owner 发出去的邀请码。
//
// 一张码 = 一个访客身份的入口:它指向一个 role(人格 + 语料范围 + 能力),再叠上这张码自己的
// 配额(几个人、每会话几轮)、per-code 的 ACL 收窄(见 codes_acl.go)、引导目的地
// (waypoints),以及要不要强制引用证据。
//
// 别的能力想在一张码上放自己的配置(booker 的预约配额是第一个),走 CodeExtras 那个口子 ——
// 这个域不认识那些能力,见 extras.go。

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// CodesDeps —— codes 这个资源要的东西:码本身的用例、ACL 面的用例,以及别的能力在码上占的字段。
type CodesDeps struct {
	Extras CodeExtras
	Codes  usecase.CodesDeps
	ACL    usecase.CodeACLDeps
}

// Codes —— 码本身 + 它的 ACL 面。
func Codes(d CodesDeps) []fp.Op {
	return append(codeCoreOps(d), codeACLOps(d.ACL)...)
}

func codeCoreOps(d CodesDeps) []fp.Op {
	extras := extrasOr(d.Extras)
	return []fp.Op{
		{
			ID: "codes.list",
			Description: "List the owner's access codes with their role, quotas, per-code " +
				"switches and attached ghosts.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listCodes(d.Codes, extras),
		},
		{
			ID: "codes.create",
			Description: "Issue an access code against a role. The role decides persona, " +
				"corpus scope and capabilities; the code adds its own quotas.",
			InputSchema: withExtraFields(codeCreateSchema, extras.Fields()),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createCode(d.Codes, extras),
		},
		{
			ID:          "codes.revoke",
			Description: "Revoke an access code. Existing sessions keep their frozen snapshot.",
			InputSchema: codeIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      revokeCode(d.Codes),
		},
		{
			ID:          "codes.update_quotas",
			Description: "Change a code's quotas (members, turns per session, bookings).",
			InputSchema: withExtraFields(codeQuotaSchema, extras.Fields()),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateCodeQuotas(d.Codes, extras),
		},
		{
			ID: "codes.set_ghost_evidence",
			Description: "Require (or stop requiring) cited evidence before the AI answers " +
				"on this code. null clears the per-code override and inherits the role's.",
			InputSchema: codeGhostSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCodeGhostEvidence(d.Codes, extras),
		},
		{
			ID:          "codes.list_members",
			Description: "List the visitors who have claimed this code.",
			InputSchema: codeIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listCodeMembers(d.Codes),
		},
	}
}

var (
	codeIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"code_id":{"type":"string","description":"Access code id."}},
		"required":["code_id"]
	}`)

	codeCreateSchema = json.RawMessage(`{
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
			"expires_at":{"type":"string","description":"RFC3339 expiry; empty = never."}
		},
		"required":[]
	}`)

	codeQuotaSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"Access code id."},
			"max_members":{"type":["integer","null"],
				"description":"Omit to leave unchanged; null means no limit."},
			"max_turns_per_session":{"type":["integer","null"],
				"description":"Omit to leave unchanged; null means no limit."}
		},
		"required":["code_id"]
	}`)

	codeGhostSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"Access code id."},
			"require_ghost_evidence":{"type":["boolean","null"],
				"description":"true / false, or null to inherit the role's setting."}
		},
		"required":["code_id"]
	}`)
)

// codeRow —— 出站载荷形状(每个面同一份)。
//
// require_ghost_evidence 和 prompt_id 也在:归一化前 MCP 那份少了这两个,
// owner 从 Claude Code 看不出这张码有没有强制引用证据。
type codeRow struct {
	ExpiresAt            *string  `json:"expires_at,omitempty"`
	MaxMembers           *int32   `json:"max_members,omitempty"`
	MaxTurnsPerSession   *int32   `json:"max_turns_per_session,omitempty"`
	RequireGhostEvidence *bool    `json:"require_ghost_evidence"`
	PromptID             *string  `json:"prompt_id,omitempty"`
	CreatedAt            string   `json:"created_at"`
	ID                   string   `json:"id"`
	Code                 string   `json:"code"`
	Label                string   `json:"label"`
	Status               string   `json:"status"`
	AssumedRoleID        string   `json:"assumed_role_id"`
	Ghosts               []string `json:"ghosts"`
}

func toCodeRow(c *entity.Code) codeRow {
	return codeRow{
		ID: c.ID, Code: c.Code, Label: c.Label, Status: c.Status,
		AssumedRoleID: c.AssumedRoleID, Ghosts: nonNilStrings(c.Ghosts),
		MaxMembers: c.MaxMembers, MaxTurnsPerSession: c.MaxTurnsPerSession,
		RequireGhostEvidence: c.RequireGhostEvidence, PromptID: c.PromptID,
		CreatedAt: c.CreatedAt.UTC().Format(time.RFC3339),
		ExpiresAt: formatOptionalTime(c.ExpiresAt),
	}
}

// marshalCode —— 一张码 + 别的能力在它上面那几个字段。
func marshalCode(
	ctx context.Context, extras CodeExtras, c *entity.Code,
) (json.RawMessage, error) {
	row, err := json.Marshal(toCodeRow(c))
	if err != nil {
		return nil, fp.OpErr("encode code", err)
	}
	return withExtraValues(row, extras.Read(ctx, c.ID)), nil
}

func listCodes(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := deps.Codes.ListByOwner(ctx, ownerID)
		if err != nil {
			return nil, codeErr(err)
		}
		out := make([]json.RawMessage, 0, len(rows))
		for i := range rows {
			one, merr := marshalCode(ctx, extras, &rows[i])
			if merr != nil {
				return nil, merr
			}
			out = append(out, one)
		}
		return json.Marshal(out)
	}
}

// codeMemberOut —— 认领了这张码的一个访客。形状跟两个面已经发出去的那份一致
// (display_name / is_anonymous)。
type codeMemberOut struct {
	LastSeenAt  *string `json:"last_seen_at,omitempty"`
	ID          string  `json:"id"`
	DisplayName string  `json:"display_name"`
	Email       string  `json:"email,omitempty"`
	IsAnonymous bool    `json:"is_anonymous"`
}

func listCodeMembers(deps usecase.CodesDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseCodeID(raw)
		if perr != nil {
			return nil, perr
		}
		rows, err := deps.Codes.ListMembers(ctx, id)
		if err != nil {
			return nil, codeErr(err)
		}
		out := make([]codeMemberOut, 0, len(rows))
		for i := range rows {
			out = append(out, codeMemberOut{
				ID: rows[i].ID, DisplayName: rows[i].DisplayName, Email: rows[i].Email,
				IsAnonymous: rows[i].IsAnonymous,
				LastSeenAt:  formatOptionalTime(&rows[i].LastSeenAt),
			})
		}
		return json.Marshal(out)
	}
}

type codeIDArgs struct {
	CodeID string `json:"code_id"`
}

func parseCodeID(raw json.RawMessage) (string, error) {
	var in codeIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.CodeID, fp.RequireArgs([2]string{"code_id", in.CodeID})
}

// codeErr —— 域的哨兵 → 协议无关的类别。code 是已经发出去的契约,显式钉住。
func codeErr(err error) error {
	for _, c := range codeErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("code op", err)
}

var codeErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error {
		return fp.BadInput("code and assumed_role_id are required")
	}},
	{entity.ErrCodeInvalid, func() error {
		return fp.Coded(fp.NotFound("code not found"), "code_not_found")
	}},
	{entity.ErrCodeTaken, func() error {
		return fp.Coded(fp.Conflict("code already exists"), "code_taken")
	}},
	{entity.ErrDenialKindUnknown, func() error {
		return fp.BadInput("kind must be capability, skill or corpus")
	}},
}
