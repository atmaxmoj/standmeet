package ownercore

// codes_denials.go —— per-code ACL deny read/write surface (split out of codes_acl.go).
// 3 tools: codes.list_denials / codes.add_denial / codes.remove_denial.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
)

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
