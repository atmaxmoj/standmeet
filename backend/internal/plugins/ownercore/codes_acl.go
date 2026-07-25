package ownercore

// codes_acl.go —— codes read surface + per-code ACL denials over owner MCP.
// 5 tools: codes.list / codes.list_members / codes.list_denials /
// codes.add_denial / codes.remove_denial. owner-only. Every per-code tool
// owner-scopes via GetByID (code_id is caller-supplied → reject others').

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
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

func (c *codesCapability) codeRowToView(ctx context.Context, code *domain.AccessCode) codeRowView {
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

func memberRowToView(m *domain.CodeMember) memberRowView {
	v := memberRowView{
		ID: m.ID, DisplayName: m.DisplayName, Email: m.Email,
		IsAnonymous: m.IsAnonymous,
	}
	if !m.LastSeenAt.IsZero() {
		v.LastSeenAt = m.LastSeenAt.Format(time.RFC3339)
	}
	return v
}

func (c *codesCapability) listDenialsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "codes.list_denials",
		Description: "List the capability and skill ids denied on an access code " +
			"(per-code ACL: subtracted from what the code's role grants).",
		InputSchema: codeIDSchema(),
		Handler:     c.handleListDenials,
	}
}

type codeDenialsView struct {
	CapabilityIDs []string `json:"capability_ids"`
	SkillIDs      []string `json:"skill_ids"`
}

func (c *codesCapability) handleListDenials(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	codeID, perr := parseCodeIDArg(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if r := c.ownedOr404(ctx, ownerID, codeID); r != nil {
		return *r
	}
	view, err := c.loadDenials(ctx, codeID)
	if err != nil {
		c.log.Error("cap codes.list_denials", "err", err)
		return capreg.MCPError("codes.list_denials failed")
	}
	return mcputil.MarshalResult(c.log, "codes.list_denials", view)
}

func (c *codesCapability) loadDenials(
	ctx context.Context, codeID string,
) (codeDenialsView, error) {
	caps, err := c.denials.ListCapabilities(ctx, codeID)
	if err != nil {
		return codeDenialsView{}, fmt.Errorf("list capability denials: %w", err)
	}
	skills, err := c.denials.ListSkills(ctx, codeID)
	if err != nil {
		return codeDenialsView{}, fmt.Errorf("list skill denials: %w", err)
	}
	return codeDenialsView{
		CapabilityIDs: mcputil.NonNilStrings(caps),
		SkillIDs:      mcputil.NonNilStrings(skills),
	}, nil
}

func (c *codesCapability) addDenialBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "codes.add_denial",
		Description: "Deny a capability or skill on an access code (per-code ACL). " +
			"kind is 'capability' or 'skill'; target_id is the capability/skill id.",
		InputSchema: denialSchema(),
		Handler:     c.handleAddDenial,
	}
}

func (c *codesCapability) removeDenialBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "codes.remove_denial",
		Description: "Remove a per-code capability or skill denial (re-grants it if the " +
			"code's role allows). kind is 'capability' or 'skill'.",
		InputSchema: denialSchema(),
		Handler:     c.handleRemoveDenial,
	}
}

func denialSchema() json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"Access code UUID."},
			"kind":{"type":"string","description":"'capability' or 'skill'."},
			"target_id":{"type":"string","description":"Capability or skill id to deny."}
		},
		"required":["code_id","kind","target_id"]
	}`)
}

type denialArgsWire struct {
	CodeID   string `json:"code_id"`
	Kind     string `json:"kind"`
	TargetID string `json:"target_id"`
}

func validDenialKind(kind string) bool {
	return kind == "capability" || kind == "skill"
}

func parseDenialArgs(raw json.RawMessage) (denialArgsWire, error) {
	var args denialArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.CodeID == "" {
		return args, errors.New("code_id is required")
	}
	if !validDenialKind(args.Kind) {
		return args, errors.New("kind must be 'capability' or 'skill'")
	}
	if args.TargetID == "" {
		return args, errors.New("target_id is required")
	}
	return args, nil
}

func (c *codesCapability) handleAddDenial(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseDenialArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if r := c.ownedOr404(ctx, ownerID, args.CodeID); r != nil {
		return *r
	}
	if err := c.addDenial(ctx, args.Kind, args.CodeID, args.TargetID); err != nil {
		c.log.Error("cap codes.add_denial", "err", err)
		return capreg.MCPError("codes.add_denial failed")
	}
	return mcputil.MarshalResult(c.log, "codes.add_denial", map[string]any{
		"code_id": args.CodeID, "kind": args.Kind, "target_id": args.TargetID, "denied": true,
	})
}

func (c *codesCapability) addDenial(ctx context.Context, kind, codeID, target string) error {
	if kind == "skill" {
		if err := c.denials.AddSkill(ctx, codeID, target); err != nil {
			return fmt.Errorf("add skill denial: %w", err)
		}
		return nil
	}
	if err := c.denials.AddCapability(ctx, codeID, target); err != nil {
		return fmt.Errorf("add capability denial: %w", err)
	}
	return nil
}

func (c *codesCapability) handleRemoveDenial(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseDenialArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if r := c.ownedOr404(ctx, ownerID, args.CodeID); r != nil {
		return *r
	}
	if err := c.removeDenial(ctx, args.Kind, args.CodeID, args.TargetID); err != nil {
		c.log.Error("cap codes.remove_denial", "err", err)
		return capreg.MCPError("codes.remove_denial failed")
	}
	return mcputil.MarshalResult(c.log, "codes.remove_denial", map[string]any{
		"code_id": args.CodeID, "kind": args.Kind, "target_id": args.TargetID, "removed": true,
	})
}

func (c *codesCapability) removeDenial(ctx context.Context, kind, codeID, target string) error {
	if kind == "skill" {
		if err := c.denials.DeleteSkill(ctx, codeID, target); err != nil {
			return fmt.Errorf("delete skill denial: %w", err)
		}
		return nil
	}
	if err := c.denials.DeleteCapability(ctx, codeID, target); err != nil {
		return fmt.Errorf("delete capability denial: %w", err)
	}
	return nil
}
