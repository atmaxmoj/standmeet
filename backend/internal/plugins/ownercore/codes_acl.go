package ownercore

// codes_acl.go —— codes read surface + per-code ACL denials over owner MCP.
// 5 tools: codes.list / codes.list_members / codes.list_denials /
// codes.add_denial / codes.remove_denial. owner-only. Every per-code tool
// owner-scopes via GetByID (code_id is caller-supplied → reject others').

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
)

// codeDenialsStore —— per-code ACL deny read/write (backed by CodeDenialRepo).
// Pure deny: a code's role grants; these rows subtract from that grant.
type codeDenialsStore interface {
	ListCapabilities(ctx context.Context, codeID string) ([]string, error)
	ListSkills(ctx context.Context, codeID string) ([]string, error)
	AddCapability(ctx context.Context, codeID, capabilityID string) error
	AddSkill(ctx context.Context, codeID, skillID string) error
	DeleteCapability(ctx context.Context, codeID, capabilityID string) error
	DeleteSkill(ctx context.Context, codeID, skillID string) error
}

func (c *codesCapability) aclBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.listCodesBinding(), c.listMembersBinding(), c.listDenialsBinding(),
		c.addDenialBinding(), c.removeDenialBinding(),
	}
}

func codeIDSchema() json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"Access code UUID."}
		},
		"required":["code_id"]
	}`)
}

type codeIDArgsWire struct {
	CodeID string `json:"code_id"`
}

func parseCodeIDArg(raw json.RawMessage) (string, error) {
	var args codeIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return "", errors.New("invalid arguments: " + err.Error())
	}
	if args.CodeID == "" {
		return "", errors.New("code_id is required")
	}
	return args.CodeID, nil
}

// ownedOr404 —— owner-scope: reject a code_id that isn't this owner's, returning
// a prewritten "code not found" result. nil = owned, caller proceeds.
func (c *codesCapability) ownedOr404(
	ctx context.Context, ownerID, codeID string,
) *capreg.MCPResult {
	code, err := c.codes.GetByID(ctx, codeID)
	if err != nil || code.OwnerID != ownerID {
		r := capreg.MCPError("code not found")
		return &r
	}
	return nil
}

func (c *codesCapability) listCodesBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "codes.list",
		Description: "List all access codes for the owner (id / code / label / status / " +
			"assumed role / quotas / expiry).",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleListCodes,
	}
}

type codeRowView struct {
	MaxMembers         *int32   `json:"max_members,omitempty"`
	MaxTurnsPerSession *int32   `json:"max_turns_per_session,omitempty"`
	MaxBookings        *int32   `json:"max_bookings,omitempty"`
	CreatedAt          string   `json:"created_at"`
	ExpiresAt          string   `json:"expires_at,omitempty"`
	ID                 string   `json:"id"`
	Code               string   `json:"code"`
	Label              string   `json:"label"`
	Status             string   `json:"status"`
	AssumedRoleID      string   `json:"assumed_role_id"`
	Ghosts             []string `json:"ghosts"`
}

func (c *codesCapability) handleListCodes(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	rows, err := c.codes.ListByOwner(ctx, ownerID)
	if err != nil {
		c.log.Error("cap codes.list", "err", err)
		return capreg.MCPError("codes.list failed")
	}
	out := make([]codeRowView, 0, len(rows))
	for i := range rows {
		out = append(out, c.codeRowToView(ctx, &rows[i]))
	}
	return mcputil.MarshalResult(c.log, "codes.list", out)
}

func (c *codesCapability) codeRowToView(
	ctx context.Context, code *access.Code,
) codeRowView {
	v := codeRowView{
		ID: code.ID, Code: code.Code, Label: code.Label, Status: code.Status,
		AssumedRoleID: code.AssumedRoleID, Ghosts: mcputil.NonNilStrings(code.Ghosts),
		MaxMembers: code.MaxMembers, MaxTurnsPerSession: code.MaxTurnsPerSession,
		MaxBookings: c.readBookingQuota(ctx, code.ID),
		CreatedAt:   code.CreatedAt.Format(time.RFC3339),
	}
	if code.ExpiresAt != nil {
		v.ExpiresAt = code.ExpiresAt.Format(time.RFC3339)
	}
	return v
}

func (c *codesCapability) listMembersBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "codes.list_members",
		Description: "List the named visitors (members) who have used an access code.",
		InputSchema: codeIDSchema(),
		Handler:     c.handleListMembers,
	}
}

type memberRowView struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email,omitempty"`
	LastSeenAt  string `json:"last_seen_at,omitempty"`
	IsAnonymous bool   `json:"is_anonymous"`
}

func (c *codesCapability) handleListMembers(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	codeID, perr := parseCodeIDArg(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if r := c.ownedOr404(ctx, ownerID, codeID); r != nil {
		return *r
	}
	members, err := c.codes.ListMembers(ctx, codeID)
	if err != nil {
		c.log.Error("cap codes.list_members", "err", err)
		return capreg.MCPError("codes.list_members failed")
	}
	out := make([]memberRowView, 0, len(members))
	for i := range members {
		out = append(out, memberRowToView(&members[i]))
	}
	return mcputil.MarshalResult(c.log, "codes.list_members", out)
}

func memberRowToView(m *access.CodeMember) memberRowView {
	v := memberRowView{
		ID: m.ID, DisplayName: m.DisplayName, Email: m.Email,
		IsAnonymous: m.IsAnonymous,
	}
	if !m.LastSeenAt.IsZero() {
		v.LastSeenAt = m.LastSeenAt.Format(time.RFC3339)
	}
	return v
}
