// res_codes_ops.go —— codes 资源的解参 / 调用 / 序列化(声明在 res_codes.go)。

package dispatcher

import (
	"context"
	"encoding/json"
	"time"
)

// codeRow —— 出站载荷形状(两个面同一份)。
//
// require_ghost_evidence 和 prompt_id 也在:迁移前 MCP 那份少了这两个,
// owner 从 Claude Code 看不出这张码有没有强制引用证据。
type codeRow struct {
	ExpiresAt            *string  `json:"expires_at,omitempty"`
	MaxMembers           *int32   `json:"max_members,omitempty"`
	MaxTurnsPerSession   *int32   `json:"max_turns_per_session,omitempty"`
	MaxBookings          *int32   `json:"max_bookings"`
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

func toCodeRow(c *Code) codeRow {
	return codeRow{
		ID: c.ID, Code: c.Code, Label: c.Label, Status: c.Status,
		AssumedRoleID: c.AssumedRoleID, Ghosts: nonNilStrings(c.Ghosts),
		MaxMembers: c.MaxMembers, MaxTurnsPerSession: c.MaxTurnsPerSession,
		MaxBookings: c.MaxBookings, RequireGhostEvidence: c.RequireGhostEvidence,
		PromptID:  c.PromptID,
		CreatedAt: c.CreatedAt.UTC().Format(time.RFC3339),
		ExpiresAt: formatOptionalTime(c.ExpiresAt),
	}
}

type codeIDArgs struct {
	CodeID string `json:"code_id"`
}

func parseCodeID(raw json.RawMessage) (string, error) {
	var in codeIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", BadInput("invalid arguments: " + err.Error())
	}
	if in.CodeID == "" {
		return "", BadInput("code_id is required")
	}
	return in.CodeID, nil
}

func parseCodeDenial(raw json.RawMessage) (*CodeDenialRef, error) {
	var in denialArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, BadInput("invalid arguments: " + err.Error())
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	return &CodeDenialRef{CodeID: in.CodeID, Kind: in.Kind, TargetID: in.TargetID}, nil
}

type denialArgs struct {
	CodeID   string `json:"code_id"`
	Kind     string `json:"kind"`
	TargetID string `json:"target_id"`
}

func (a denialArgs) validate() error {
	if a.CodeID == "" || a.Kind == "" || a.TargetID == "" {
		return BadInput("code_id, kind and target_id are required")
	}
	if !validDenialKind(a.Kind) {
		return BadInput("kind must be capability, skill or corpus")
	}
	return nil
}

func validDenialKind(kind string) bool {
	return kind == DenialKindCapability || kind == DenialKindSkill || kind == DenialKindCorpus
}

func codesList(store CodeStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, opErr("list codes", err)
		}
		out := make([]codeRow, 0, len(rows))
		for i := range rows {
			out = append(out, toCodeRow(&rows[i]))
		}
		return marshalOut(out)
	}
}

type codeCreateArgs struct {
	MaxMembers         *int32   `json:"max_members"`
	MaxTurnsPerSession *int32   `json:"max_turns_per_session"`
	MaxBookings        *int32   `json:"max_bookings"`
	PromptID           *string  `json:"prompt_id"`
	Code               string   `json:"code"`
	Label              string   `json:"label"`
	Purpose            string   `json:"purpose"`
	AssumedRoleID      string   `json:"assumed_role_id"`
	ExpiresAt          string   `json:"expires_at"`
	Ghosts             []string `json:"ghosts"`
}

func codesCreate(store CodeStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeCreateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		expires, eerr := parseOptionalRFC3339(in.ExpiresAt)
		if eerr != nil {
			return nil, eerr
		}
		code, err := store.Create(ctx, in.toCreateCode(ownerID, expires))
		if err != nil {
			return nil, opErr("create code", err)
		}
		row := toCodeRow(&code)
		return marshalOut(row)
	}
}

// toCreateCode —— 入参 → 收口的写入形状。assumed_role_id 留空由适配器兜到 public role
// (面板一直是这么做的;MCP 那边以前**必填**,于是同一件事两个面规则不同)。
func (in *codeCreateArgs) toCreateCode(ownerID string, expires *time.Time) *CreateCode {
	return &CreateCode{
		OwnerID: ownerID, Code: derivedCode(in.Code, in.Label), Label: in.Label,
		Purpose: in.Purpose, Ghosts: nonNilStrings(in.Ghosts),
		AssumedRoleID: in.AssumedRoleID, PromptID: in.PromptID,
		MaxMembers: in.MaxMembers, MaxTurnsPerSession: in.MaxTurnsPerSession,
		MaxBookings: in.MaxBookings, ExpiresAt: expires,
	}
}

// parseOptionalRFC3339 —— 空 = 不设(永不过期),不是错。
func parseOptionalRFC3339(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // 空 = 没设,不是错误
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, BadInput("expires_at must be RFC3339 or empty")
	}
	return &t, nil
}

func codesRevoke(store CodeStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseCodeID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := store.Revoke(ctx, ownerID, id); err != nil {
			return nil, opErr("revoke code", err)
		}
		return marshalOut(revokedOut{CodeID: id, Revoked: true})
	}
}

// revokedOut —— 撤销的回执。它不是一行码,是"对哪张码做完了什么",所以字段跟**入参**同名
// (code_id),不是行里的 id。
type revokedOut struct {
	CodeID  string `json:"code_id"`
	Revoked bool   `json:"revoked"`
}

type codeQuotaArgs struct {
	MaxMembers         OptionalInt32 `json:"max_members"`
	MaxTurnsPerSession OptionalInt32 `json:"max_turns_per_session"`
	MaxBookings        OptionalInt32 `json:"max_bookings"`
	CodeID             string        `json:"code_id"`
}

func codesUpdateQuotas(store CodeStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeQuotaArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.CodeID == "" {
			return nil, BadInput("code_id is required")
		}
		code, err := store.UpdateQuotas(ctx, &UpdateCodeQuotas{
			OwnerID: ownerID, CodeID: in.CodeID, MaxMembers: in.MaxMembers,
			MaxTurnsPerSession: in.MaxTurnsPerSession, MaxBookings: in.MaxBookings,
		})
		if err != nil {
			return nil, opErr("update quotas", err)
		}
		row := toCodeRow(&code)
		return marshalOut(row)
	}
}

type codeGhostArgs struct {
	RequireGhostEvidence *bool  `json:"require_ghost_evidence"`
	CodeID               string `json:"code_id"`
}

func codesSetGhostEvidence(store CodeStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeGhostArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.CodeID == "" {
			return nil, BadInput("code_id is required")
		}
		code, err := store.SetGhostEvidence(ctx, ownerID, in.CodeID, in.RequireGhostEvidence)
		if err != nil {
			return nil, opErr("set ghost evidence", err)
		}
		row := toCodeRow(&code)
		return marshalOut(row)
	}
}

type codeMemberOut struct {
	LastSeenAt  *string `json:"last_seen_at,omitempty"`
	ID          string  `json:"id"`
	DisplayName string  `json:"display_name"`
	Email       string  `json:"email,omitempty"`
	IsAnonymous bool    `json:"is_anonymous"`
}

func codesMembers(store CodeStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseCodeID(raw)
		if perr != nil {
			return nil, perr
		}
		rows, err := store.Members(ctx, ownerID, id)
		if err != nil {
			return nil, opErr("list members", err)
		}
		out := make([]codeMemberOut, 0, len(rows))
		for i := range rows {
			out = append(out, codeMemberOut{
				ID: rows[i].ID, DisplayName: rows[i].DisplayName, Email: rows[i].Email,
				IsAnonymous: rows[i].IsAnonymous,
				LastSeenAt:  formatOptionalTime(rows[i].LastSeenAt),
			})
		}
		return marshalOut(out)
	}
}
