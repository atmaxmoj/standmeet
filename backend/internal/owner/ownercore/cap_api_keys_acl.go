package ownercore

// cap_api_keys_acl.go —— per-key ACL denials + the api candidacy ("open") gate for the API-key
// facade. 6 tools: api_keys.list_denials / api_keys.add_denial / api_keys.remove_denial
// (per-key deny, mirror codes ACL) + api.open / api.close / api.list_candidates (owner-wide
// candidacy). Every per-key tool owner-scopes via GetByID (BOLA guard, mirror codes_acl.go).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
)

func (c *apiKeysCapability) aclBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.listDenialsBinding(), c.addDenialBinding(), c.removeDenialBinding(),
		c.apiOpenBinding(), c.apiCloseBinding(), c.apiListCandidatesBinding(),
	}
}

// ownedOr404 —— owner-scope guard: reject a key_id that isn't this owner's, returning a prewritten
// "api key not found" result. nil = owned, caller proceeds.
func (c *apiKeysCapability) ownedOr404(
	ctx context.Context, ownerID, keyID string,
) *capreg.MCPResult {
	if _, err := c.deps.Keys.GetByID(ctx, keyID, ownerID); err != nil {
		r := capreg.MCPError("api key not found")
		return &r
	}
	return nil
}

// ───── per-key denials ──────────────────────────────────────────

func keyIDSchema() json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"key_id":{"type":"string","description":"API key UUID."}
		},
		"required":["key_id"]
	}`)
}

type keyIDArgsWire struct {
	KeyID string `json:"key_id"`
}

func parseKeyIDArg(raw json.RawMessage) (string, error) {
	var args keyIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return "", errors.New("invalid arguments: " + err.Error())
	}
	if args.KeyID == "" {
		return "", errors.New("key_id is required")
	}
	return args.KeyID, nil
}

func (c *apiKeysCapability) listDenialsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "api_keys.list_denials",
		Description: "List the capability and skill ids denied on an API key " +
			"(per-key ACL: subtracted from what the key's assumed role grants).",
		InputSchema: keyIDSchema(),
		Handler:     c.handleListDenials,
	}
}

type keyDenialsView struct {
	CapabilityIDs []string `json:"capability_ids"`
	SkillIDs      []string `json:"skill_ids"`
}

func (c *apiKeysCapability) handleListDenials(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	keyID, perr := parseKeyIDArg(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if r := c.ownedOr404(ctx, ownerID, keyID); r != nil {
		return *r
	}
	view, err := c.loadKeyDenials(ctx, keyID)
	if err != nil {
		return c.failf("api_keys.list_denials", err)
	}
	return mcputil.MarshalResult(c.log, "api_keys.list_denials", view)
}

func (c *apiKeysCapability) loadKeyDenials(
	ctx context.Context, keyID string,
) (keyDenialsView, error) {
	caps, err := c.deps.Keys.ListCapabilityDenials(ctx, keyID)
	if err != nil {
		return keyDenialsView{}, fmt.Errorf("list capability denials: %w", err)
	}
	skills, err := c.deps.Keys.ListSkillDenials(ctx, keyID)
	if err != nil {
		return keyDenialsView{}, fmt.Errorf("list skill denials: %w", err)
	}
	return keyDenialsView{
		CapabilityIDs: mcputil.NonNilStrings(caps),
		SkillIDs:      mcputil.NonNilStrings(skills),
	}, nil
}

func (c *apiKeysCapability) addDenialBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "api_keys.add_denial",
		Description: "Deny a capability or skill on an API key (per-key ACL). " +
			"kind is 'capability' or 'skill'; target_id is the capability/skill id.",
		InputSchema: keyDenialSchema(),
		Handler:     c.handleAddDenial,
	}
}

func (c *apiKeysCapability) removeDenialBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "api_keys.remove_denial",
		Description: "Remove a per-key capability or skill denial (re-grants it if the " +
			"key's assumed role allows). kind is 'capability' or 'skill'.",
		InputSchema: keyDenialSchema(),
		Handler:     c.handleRemoveDenial,
	}
}

func keyDenialSchema() json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"key_id":{"type":"string","description":"API key UUID."},
			"kind":{"type":"string","description":"'capability' or 'skill'."},
			"target_id":{"type":"string","description":"Capability or skill id to deny."}
		},
		"required":["key_id","kind","target_id"]
	}`)
}

type keyDenialArgsWire struct {
	KeyID    string `json:"key_id"`
	Kind     string `json:"kind"`
	TargetID string `json:"target_id"`
}

func parseKeyDenialArgs(raw json.RawMessage) (keyDenialArgsWire, error) {
	var args keyDenialArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if err := validateKeyDenial(&args); err != nil {
		return args, err
	}
	return args, nil
}

func validateKeyDenial(a *keyDenialArgsWire) error {
	if a.KeyID == "" {
		return errors.New("key_id is required")
	}
	if a.Kind != "capability" && a.Kind != "skill" {
		return errors.New("kind must be 'capability' or 'skill'")
	}
	if a.TargetID == "" {
		return errors.New("target_id is required")
	}
	return nil
}

func (c *apiKeysCapability) handleAddDenial(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseKeyDenialArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if r := c.ownedOr404(ctx, ownerID, args.KeyID); r != nil {
		return *r
	}
	if err := c.addDenial(ctx, args.Kind, args.KeyID, args.TargetID); err != nil {
		return c.failf("api_keys.add_denial", err)
	}
	return mcputil.MarshalResult(c.log, "api_keys.add_denial", map[string]any{
		"key_id": args.KeyID, "kind": args.Kind, "target_id": args.TargetID, "denied": true,
	})
}

func (c *apiKeysCapability) addDenial(ctx context.Context, kind, keyID, target string) error {
	if kind == "skill" {
		if err := c.deps.Keys.AddSkillDenial(ctx, keyID, target); err != nil {
			return fmt.Errorf("add skill denial: %w", err)
		}
		return nil
	}
	if err := c.deps.Keys.AddCapabilityDenial(ctx, keyID, target); err != nil {
		return fmt.Errorf("add capability denial: %w", err)
	}
	return nil
}

func (c *apiKeysCapability) handleRemoveDenial(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseKeyDenialArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if r := c.ownedOr404(ctx, ownerID, args.KeyID); r != nil {
		return *r
	}
	if err := c.removeDenial(ctx, args.Kind, args.KeyID, args.TargetID); err != nil {
		return c.failf("api_keys.remove_denial", err)
	}
	return mcputil.MarshalResult(c.log, "api_keys.remove_denial", map[string]any{
		"key_id": args.KeyID, "kind": args.Kind, "target_id": args.TargetID, "removed": true,
	})
}

func (c *apiKeysCapability) removeDenial(ctx context.Context, kind, keyID, target string) error {
	if kind == "skill" {
		if err := c.deps.Keys.DeleteSkillDenial(ctx, keyID, target); err != nil {
			return fmt.Errorf("delete skill denial: %w", err)
		}
		return nil
	}
	if err := c.deps.Keys.DeleteCapabilityDenial(ctx, keyID, target); err != nil {
		return fmt.Errorf("delete capability denial: %w", err)
	}
	return nil
}

// ───── api candidacy ("open") ───────────────────────────────────

func capabilityIDSchema() json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"capability_id":{"type":"string","description":"Capreg capability id."}
		},
		"required":["capability_id"]
	}`)
}

type capabilityIDArgsWire struct {
	CapabilityID string `json:"capability_id"`
}

func parseCapabilityIDArg(raw json.RawMessage) (string, error) {
	var args capabilityIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return "", errors.New("invalid arguments: " + err.Error())
	}
	if args.CapabilityID == "" {
		return "", errors.New("capability_id is required")
	}
	return args.CapabilityID, nil
}

func isAPICandidate(capabilityID string) bool {
	return slices.Contains(paritymanifest.APICandidateCapabilities(), capabilityID)
}

func (c *apiKeysCapability) apiOpenBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "api.open",
		Description: "Open a capability to the API facade (make it an API candidate). " +
			"Only non-Agentic outward capabilities may be opened.",
		InputSchema: capabilityIDSchema(),
		Handler:     c.handleAPIOpen,
	}
}

func (c *apiKeysCapability) handleAPIOpen(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	capID, perr := parseCapabilityIDArg(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if !isAPICandidate(capID) {
		return capreg.MCPError("capability is not an API candidate")
	}
	if err := c.deps.Keys.OpenCapability(ctx, ownerID, capID); err != nil {
		return c.failf("api.open", err)
	}
	return mcputil.MarshalResult(c.log, "api.open", map[string]any{
		"capability_id": capID, "opened": true,
	})
}

func (c *apiKeysCapability) apiCloseBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "api.close",
		Description: "Close a capability from the API facade (withdraw its candidacy). " +
			"Keys whose role granted it stop reaching it immediately.",
		InputSchema: capabilityIDSchema(),
		Handler:     c.handleAPIClose,
	}
}

func (c *apiKeysCapability) handleAPIClose(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	capID, perr := parseCapabilityIDArg(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if err := c.deps.Keys.CloseCapability(ctx, ownerID, capID); err != nil {
		return c.failf("api.close", err)
	}
	return mcputil.MarshalResult(c.log, "api.close", map[string]any{
		"capability_id": capID, "closed": true,
	})
}

func (c *apiKeysCapability) apiListCandidatesBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "api.list_candidates",
		Description: "List the capabilities that may be opened to the API facade " +
			"(available) and the ones currently opened for the owner (opened).",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleAPIListCandidates,
	}
}

func (c *apiKeysCapability) handleAPIListCandidates(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	opened, err := c.deps.Keys.ListOpenCapabilities(ctx, ownerID)
	if err != nil {
		return c.failf("api.list_candidates", err)
	}
	return mcputil.MarshalResult(c.log, "api.list_candidates", map[string]any{
		"available": paritymanifest.APICandidateCapabilities(),
		"opened":    mcputil.NonNilStrings(opened),
	})
}
