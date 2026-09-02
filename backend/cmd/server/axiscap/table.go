// table.go — how the "what can visitors use" table is assembled (declared in ops.go).
//
// This table has to read four places: the capability registry (which capabilities exist +
// their origin), capability_settings (which ones the owner disabled), the owner's own skills,
// and the connector slots (whether calendar / mail are connected). Both plugin axes live on
// this side, so this cross-four-place orchestration lives here too.

package axiscap

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/connector"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

// Stable row ids for the connector kind (can be disabled, not deleted — disconnect, not delete).
const (
	connectorGCalRowID = "connector.google-calendar"
	connectorMailRowID = "connector.smtp"
)

type capabilityOps struct {
	registry   *capreg.Registry
	settings   *access.CapabilityRepo
	skills     *marketplace.SkillRepo
	connectors *connector.Repo
}

func newCapabilityOps(d *deps.Runtime) capabilityOps {
	return capabilityOps{
		registry: d.AgentSkills, settings: d.CapabilityRepo,
		skills: d.SkillRepo, connectors: d.ConnectorRepo,
	}
}

// capabilityFacts — every IO result needed to assemble one listing, read all at once.
type capabilityFacts struct {
	disabled map[string]bool
	skills   []marketplace.Skill
	gcal     bool
	mail     bool
}

func (a capabilityOps) List(ctx context.Context, ownerID string) ([]capabilityRow, error) {
	facts, err := a.load(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("load capability facts: %w", err)
	}
	rows := a.registryRows(&facts)
	rows = append(rows, connectorSlotRows(&facts)...)
	return append(rows, ownerSkillRows(&facts)...), nil
}

// SetEnabled — the toggle is written to **whichever table actually reads it**: a registry
// capability → capability_settings; an owner skill → the skill's own Enabled. Connector rows
// are locked in the frontend and never take this path.
func (a capabilityOps) SetEnabled(ctx context.Context, ownerID, id string, enabled bool) error {
	if _, ok := a.registry.OriginOf(id); ok {
		if err := a.settings.SetEnabled(ctx, ownerID, id, enabled); err != nil {
			return fmt.Errorf("set capability enabled: %w", err)
		}
		return nil
	}
	if _, err := a.skills.SetEnabled(ctx, ownerID, id, enabled); err != nil {
		return fmt.Errorf("set skill enabled: %w", err)
	}
	return nil
}

// Delete — only an owner-authored skill can be deleted. Registry capabilities
// (builtin/managed) and connector rows are both rejected.
func (a capabilityOps) Delete(ctx context.Context, ownerID, id string) error {
	if !a.deletable(id) {
		return fp.BadInput("this capability is built in and cannot be deleted")
	}
	if err := a.skills.Delete(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete owner skill: %w", err)
	}
	return nil
}

func (a capabilityOps) load(ctx context.Context, ownerID string) (capabilityFacts, error) {
	disabled, derr := a.settings.DisabledSet(ctx, ownerID)
	if derr != nil {
		return capabilityFacts{}, fmt.Errorf("disabled set: %w", derr)
	}
	skills, serr := a.skills.ListByOwner(ctx, ownerID)
	if serr != nil {
		return capabilityFacts{}, fmt.Errorf("list owner skills: %w", serr)
	}
	return capabilityFacts{
		disabled: disabled, skills: skills,
		gcal: a.categoryConnected(ctx, ownerID, "calendar"),
		mail: a.categoryConnected(ctx, ownerID, "mail"),
	}, nil
}

// categoryConnected — whether the category slot has an active, connected connector. A read
// failure is treated as not connected: this is a display state, and shouldn't be able to
// break the whole table.
func (a capabilityOps) categoryConnected(ctx context.Context, ownerID, category string) bool {
	ok, err := a.connectors.CategoryConnected(ctx, ownerID, category)
	return err == nil && ok
}

// registryRows — one row per **visitor-facing** capability in the registry.
//
// owner-only ones aren't listed: the owner-enable gate only applies to visitor assembly, so
// giving them a toggle would be a toggle that does nothing.
func (a capabilityOps) registryRows(facts *capabilityFacts) []capabilityRow {
	caps := a.registry.List()
	out := make([]capabilityRow, 0, len(caps))
	for _, c := range caps {
		if c.Shape() == capreg.ShapeOwnerOnly {
			continue
		}
		id := c.ID()
		origin, _ := a.registry.OriginOf(id)
		out = append(out, capabilityRow{
			ID: id, Title: capabilityTitleOf(c), Origin: string(origin), Kind: "capability",
			Enabled: !facts.disabled[id], Deletable: origin.Deletable(),
			Dependency: dependencyOf(id, facts),
		})
	}
	return out
}

func (a capabilityOps) deletable(id string) bool {
	if _, ok := a.registry.OriginOf(id); ok {
		return false
	}
	return id != connectorGCalRowID && id != connectorMailRowID
}

func capabilityTitleOf(c capreg.Capability) string {
	if t, ok := c.(capreg.Titled); ok {
		return t.Title()
	}
	return ""
}

// dependencyOf — which connector this capability is waiting on, and whether it's connected.
// No dependency → returns nil.
func dependencyOf(id string, facts *capabilityFacts) *capabilityDependency {
	switch id {
	case "calendar.book":
		return &capabilityDependency{Name: "Google Calendar", Connected: facts.gcal}
	case "mail.send":
		return &capabilityDependency{Name: "Mail", Connected: facts.mail}
	default:
		return nil
	}
}

// connectorSlotRows — one row per platform-managed connector slot. Can be disabled, not
// deleted (disconnect, not delete).
func connectorSlotRows(facts *capabilityFacts) []capabilityRow {
	managed := string(capreg.OriginManaged)
	return []capabilityRow{
		{
			ID: connectorGCalRowID, Origin: managed, Kind: "connector",
			Enabled: facts.gcal, Deletable: false,
			Dependency: &capabilityDependency{Name: "Google Calendar", Connected: facts.gcal},
		},
		{
			ID: connectorMailRowID, Origin: managed, Kind: "connector",
			Enabled: facts.mail, Deletable: false,
			Dependency: &capabilityDependency{Name: "SMTP", Connected: facts.mail},
		},
	}
}

// ownerSkillRows — one row per owner-authored skill.
//
// enabled reads **the skill's own** global toggle (the one the skill runner actually reads),
// not capability_settings — a skill isn't a registry capability, so don't treat the
// owner-enable gate's table as its source of truth.
func ownerSkillRows(facts *capabilityFacts) []capabilityRow {
	out := make([]capabilityRow, 0, len(facts.skills))
	for i := range facts.skills {
		s := &facts.skills[i]
		if s.IsBuiltin {
			continue // a built-in skill doesn't count as owner-origin, and can't be deleted
		}
		// Title must be given: a skill's id is a UUID. A built-in capability's id already
		// reads like plain language (mail.send), so rendering only the id looks fine — until
		// an owner-authored skill shows up, and that row is left as a string of hex digits
		// with a toggle and a delete button hanging next to it.
		out = append(out, capabilityRow{
			ID: s.ID, Title: s.Name, Origin: string(capreg.OriginOwner), Kind: "skill",
			Enabled: s.Enabled, Deletable: true,
		})
	}
	return out
}
