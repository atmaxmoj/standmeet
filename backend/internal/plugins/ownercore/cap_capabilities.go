package ownercore

// cap_capabilities.go —— owner-side capability catalog Capability.
// 3 tools: capabilities.list / capabilities.set_enabled / capabilities.delete.
// owner-only. Mirrors the admin /api/admin/capabilities route over MCP but
// returns a leaner shape (id / kind / origin / enabled / deletable [+ dep]).
//
// origin decides existence (deletability); enabled decides visitor availability
// (the owner-enable gate, capability_settings, applied at visitor assembly).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
)

const capCapabilitiesBundle = "capabilities.bundle"

// ───── narrow deps ──────────────────────────────────────────────

// capRegistry —— origin + full capability list from capreg.Registry.
type capRegistry interface {
	List() []capreg.Capability
	OriginOf(id string) (capreg.Origin, bool)
}

// capSettingsStore —— owner-enable gate table (capability_settings).
type capSettingsStore interface {
	SetEnabled(ctx context.Context, ownerID, capabilityID string, enabled bool) error
	DisabledSet(ctx context.Context, ownerID string) (map[string]bool, error)
}

// capSkillStore —— owner-authored skills (their own enable flag + delete).
type capSkillStore interface {
	ListByOwner(ctx context.Context, ownerID string) ([]marketplace.Skill, error)
	SetEnabled(
		ctx context.Context, ownerID, skillID string, enabled bool,
	) (marketplace.Skill, error)
	Delete(ctx context.Context, ownerID, skillID string) error
}

// capConnectorStore —— per-category connector slot status (dependency badge).
type capConnectorStore interface {
	CategoryConnected(ctx context.Context, ownerID, category string) (bool, error)
}

// CapabilitiesOwnerDeps —— newCapabilitiesCapability 入参打包。Registry gives
// origin + list; Settings reads/writes owner-enable; Skills lists/toggles/deletes
// owner-origin skills; Connectors reads dependency status.
type CapabilitiesOwnerDeps struct {
	Registry   capRegistry
	Settings   capSettingsStore
	Skills     capSkillStore
	Connectors capConnectorStore
}

type capabilitiesCapability struct {
	deps *CapabilitiesOwnerDeps
	log  *slog.Logger
}

func newCapabilitiesCapability(
	deps *CapabilitiesOwnerDeps, log *slog.Logger,
) *capabilitiesCapability {
	return &capabilitiesCapability{deps: deps, log: log}
}

func (*capabilitiesCapability) ID() string          { return capCapabilitiesBundle }
func (*capabilitiesCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*capabilitiesCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*capabilitiesCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*capabilitiesCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *capabilitiesCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.listBinding(), c.setEnabledBinding(), c.deleteBinding(),
	}
}

// ───── capabilities.list ────────────────────────────────────────

// capabilityRow —— MCP wire view: visitor-facing registry capabilities +
// owner-authored skills. dependency_connected is set only for caps with a
// connector dependency (calendar.book / mail.send).
type capabilityRow struct {
	DependencyConnected *bool  `json:"dependency_connected,omitempty"`
	ID                  string `json:"id"`
	Title               string `json:"title,omitempty"`
	Kind                string `json:"kind"`
	Origin              string `json:"origin"`
	Enabled             bool   `json:"enabled"`
	Deletable           bool   `json:"deletable"`
}

func (c *capabilitiesCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "capabilities.list",
		Description: "List visitor-facing capabilities and owner-authored skills " +
			"with their origin, enabled state, deletability, and (where relevant) " +
			"connector dependency status.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

func (c *capabilitiesCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	disabled, err := c.deps.Settings.DisabledSet(ctx, ownerID)
	if err != nil {
		c.log.Error("cap capabilities.list disabled set", "err", err)
		return capreg.MCPError("capabilities.list failed")
	}
	skills, serr := c.deps.Skills.ListByOwner(ctx, ownerID)
	if serr != nil {
		c.log.Error("cap capabilities.list skills", "err", serr)
		return capreg.MCPError("capabilities.list failed")
	}
	gcal := c.categoryConnected(ctx, ownerID, "calendar")
	mail := c.categoryConnected(ctx, ownerID, "mail")
	rows := c.registryRows(disabled, gcal, mail)
	rows = append(rows, skillRows(skills)...)
	return mcputil.MarshalResult(c.log, "capabilities.list", rows)
}

// registryRows —— visitor-facing registry capabilities (owner-only skipped: the
// owner-enable gate only affects visitor assembly, so a toggle there is a no-op).
func (c *capabilitiesCapability) registryRows(
	disabled map[string]bool, gcal, mail bool,
) []capabilityRow {
	caps := c.deps.Registry.List()
	out := make([]capabilityRow, 0, len(caps))
	for _, item := range caps {
		if item.Shape() == capreg.ShapeOwnerOnly {
			continue
		}
		id := item.ID()
		origin, _ := c.deps.Registry.OriginOf(id)
		out = append(out, capabilityRow{
			ID: id, Title: capabilityTitle(item), Kind: "capability",
			Origin: string(origin), Enabled: !disabled[id],
			Deletable:           origin.Deletable(),
			DependencyConnected: dependencyConnected(id, gcal, mail),
		})
	}
	return out
}

// dependencyConnected —— connector-dependent caps expose their slot status.
func dependencyConnected(id string, gcal, mail bool) *bool {
	switch id {
	case "calendar.book":
		return &gcal
	case "mail.send":
		return &mail
	default:
		return nil
	}
}

// skillRows —— owner-authored (non-builtin) skills; enabled is the skill's own
// global flag (marketplace.Skill.Enabled), not capability_settings.
func skillRows(skills []marketplace.Skill) []capabilityRow {
	out := make([]capabilityRow, 0, len(skills))
	for i := range skills {
		s := &skills[i]
		if s.IsBuiltin {
			continue
		}
		out = append(out, capabilityRow{
			ID: s.ID, Kind: "skill", Origin: string(capreg.OriginOwner),
			Enabled: s.Enabled, Deletable: true,
		})
	}
	return out
}

func capabilityTitle(c capreg.Capability) string {
	if t, ok := c.(capreg.Titled); ok {
		return t.Title()
	}
	return ""
}

func (c *capabilitiesCapability) categoryConnected(
	ctx context.Context, ownerID, category string,
) bool {
	ok, err := c.deps.Connectors.CategoryConnected(ctx, ownerID, category)
	if err != nil {
		return false
	}
	return ok
}

// ───── capabilities.set_enabled ─────────────────────────────────

func (c *capabilitiesCapability) setEnabledBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "capabilities.set_enabled",
		Description: "Owner-enable toggle. Registry capabilities write to the " +
			"owner-enable gate (capability_settings); owner skills write their own " +
			"global enabled flag.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Capability or skill id."},
				"enabled":{"type":"boolean","description":"Enable (true) or disable (false)."}
			},
			"required":["id","enabled"]
		}`),
		Handler: c.handleSetEnabled,
	}
}

type capSetEnabledArgsWire struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

func parseCapSetEnabledArgs(raw json.RawMessage) (capSetEnabledArgsWire, error) {
	var args capSetEnabledArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.ID == "" {
		return args, errors.New("id is required")
	}
	return args, nil
}

func (c *capabilitiesCapability) handleSetEnabled(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseCapSetEnabledArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if err := c.applyEnabled(ctx, ownerID, args.ID, args.Enabled); err != nil {
		if errors.Is(err, marketplace.ErrSkillNotFound) {
			return capreg.MCPError("capability or skill not found")
		}
		c.log.Error("cap capabilities.set_enabled", "err", err)
		return capreg.MCPError("capabilities.set_enabled failed")
	}
	return mcputil.MarshalResult(c.log, "capabilities.set_enabled", map[string]any{
		"id": args.ID, "enabled": args.Enabled, "ok": true,
	})
}

// applyEnabled —— write to the table that actually reads it: registry capability
// → capability_settings; otherwise treat id as an owner skill.
func (c *capabilitiesCapability) applyEnabled(
	ctx context.Context, ownerID, id string, enabled bool,
) error {
	if _, ok := c.deps.Registry.OriginOf(id); ok {
		if err := c.deps.Settings.SetEnabled(ctx, ownerID, id, enabled); err != nil {
			return fmt.Errorf("set capability enabled: %w", err)
		}
		return nil
	}
	if _, err := c.deps.Skills.SetEnabled(ctx, ownerID, id, enabled); err != nil {
		return fmt.Errorf("set skill enabled: %w", err)
	}
	return nil
}

// ───── capabilities.delete ──────────────────────────────────────

func (c *capabilitiesCapability) deleteBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "capabilities.delete",
		Description: "Delete an owner-origin capability (an owner-authored skill). " +
			"Built-in / managed registry capabilities cannot be deleted.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Owner skill id."}
			},
			"required":["id"]
		}`),
		Handler: c.handleDelete,
	}
}

type capDeleteArgsWire struct {
	ID string `json:"id"`
}

func (c *capabilitiesCapability) handleDelete(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args capDeleteArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.ID == "" {
		return capreg.MCPError("id is required")
	}
	return c.deleteOwnerCap(ctx, ownerID, args.ID)
}

func (c *capabilitiesCapability) deleteOwnerCap(
	ctx context.Context, ownerID, id string,
) capreg.MCPResult {
	if _, ok := c.deps.Registry.OriginOf(id); ok {
		return capreg.MCPError("this capability is built in and cannot be deleted")
	}
	if err := c.deps.Skills.Delete(ctx, ownerID, id); err != nil {
		if errors.Is(err, marketplace.ErrSkillNotFound) ||
			errors.Is(err, marketplace.ErrSkillBuiltinImmutable) {
			return capreg.MCPError("owner capability not found")
		}
		c.log.Error("cap capabilities.delete", "err", err)
		return capreg.MCPError("capabilities.delete failed")
	}
	return mcputil.MarshalResult(c.log, "capabilities.delete", map[string]any{
		"id": id, "deleted": true,
	})
}
