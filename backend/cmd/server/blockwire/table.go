// table.go — how the "what can visitors use" table is assembled (declared in ops.go).
//
// This table has to read four places: the block registry (which blocks exist +
// their origin), block_enabled (which ones the owner disabled), the owner's own skills,
// and the seam slots (whether calendar / mail have a connected supplier). Both halves of
// the block model live on this side, so this cross-four-place orchestration lives here too.

package blockwire

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin/assembly"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// supplierRowPrefix — a supplier row's id is its seam under this prefix, so that a
// supplier row and a block row can never collide in one table.
//
// It used to be two constants naming two shipped suppliers. See seamTitles().
const supplierRowPrefix = "supplier."

// supplierRowID — the table row id for a seam slot.
func supplierRowID(seam string) string { return supplierRowPrefix + seam }

type blockOps struct {
	registry  *registry.Registry
	settings  *access.BlockEnableRepo
	skills    *marketplace.SkillRepo
	suppliers *credentials.Repo
	assembly  *assembly.Repo
}

func newBlockOps(d *deps.Runtime) blockOps {
	return blockOps{
		registry: d.AgentSkills, settings: d.BlockEnableRepo,
		skills: d.SkillRepo, suppliers: d.Credentials,
		assembly: d.Assembly,
	}
}

// blockFacts — every IO result needed to assemble one listing, read all at once.
type blockFacts struct {
	disabled map[string]bool
	// installed —— the blocks THIS owner installed, by id. The registry is
	// process-wide; this is what scopes the owner-origin rows back to their owner.
	installed map[string]bool
	// seams —— one entry per seam a built-in supplier declares, mapped to whether this
	// owner has that seam connected. Read from the manifests, never from a list here.
	seams  map[string]bool
	skills []marketplace.Skill
}

func (a blockOps) List(ctx context.Context, ownerID string) ([]blockRow, error) {
	facts, err := a.load(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("load block facts: %w", err)
	}
	rows := a.registryRows(&facts)
	rows = append(rows, supplierSlotRows(&facts)...)
	return append(rows, ownerSkillRows(&facts)...), nil
}

// SetEnabled — the toggle is written to **whichever table actually reads it**: a registry
// block → block_enabled; an owner skill → the skill's own Enabled. Supplier rows
// are locked in the frontend and never take this path.
func (a blockOps) SetEnabled(ctx context.Context, ownerID, id string, enabled bool) error {
	if _, ok := a.registry.OriginOf(id); ok {
		if err := a.settings.SetEnabled(ctx, ownerID, id, enabled); err != nil {
			return fmt.Errorf("set block enabled: %w", err)
		}
		return nil
	}
	if _, err := a.skills.SetEnabled(ctx, ownerID, id, enabled); err != nil {
		return fmt.Errorf("set skill enabled: %w", err)
	}
	return nil
}

// Delete — only an owner-authored skill can be deleted. Registry blocks
// (builtin/managed) and supplier rows are both rejected.
func (a blockOps) Delete(ctx context.Context, ownerID, id string) error {
	// A block the owner installed is deletable, and deleting it means uninstalling it.
	//
	// This branch is why the row's `deletable` and this method can be trusted to agree.
	// Before owners could install blocks, every registry entry was built in and the two
	// answers matched by accident: the row said `origin.Deletable()` while this method
	// refused anything the registry knew. An installed block is origin=owner, so the
	// panel offered a delete button that always failed — a control that lies.
	if a.ownerInstalled(id) {
		if err := a.assembly.Uninstall(ctx, ownerID, id); err != nil {
			return fmt.Errorf("uninstall block: %w", err)
		}
		return nil
	}
	if !a.deletable(id) {
		return fp.BadInput("this block is built in and cannot be deleted")
	}
	if err := a.skills.Delete(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete owner skill: %w", err)
	}
	return nil
}

// ownerInstalled — did this owner paste this block in, as opposed to it shipping with the image.
func (a blockOps) ownerInstalled(id string) bool {
	origin, ok := a.registry.OriginOf(id)
	return ok && origin == registry.OriginOwner
}

func (a blockOps) load(ctx context.Context, ownerID string) (blockFacts, error) {
	disabled, derr := a.settings.DisabledSet(ctx, ownerID)
	if derr != nil {
		return blockFacts{}, fmt.Errorf("disabled set: %w", derr)
	}
	skills, serr := a.skills.ListByOwner(ctx, ownerID)
	if serr != nil {
		return blockFacts{}, fmt.Errorf("list owner skills: %w", serr)
	}
	return blockFacts{
		disabled: disabled, skills: skills,
		installed: a.installedSet(ctx, ownerID),
		seams:     a.seamConnections(ctx, ownerID),
	}, nil
}

// seamConnections — every declared seam, asked once each.
func (a blockOps) seamConnections(ctx context.Context, ownerID string) map[string]bool {
	titles := seamTitles()
	out := make(map[string]bool, len(titles))
	for seam := range titles {
		out[seam] = a.seamConnected(ctx, ownerID, seam)
	}
	return out
}

// installedSet —— which blocks this owner installed, by id.
//
// A read failure yields an empty set, which hides this owner's installed blocks rather
// than showing everybody's. That is the safe direction: a missing row is a panel the
// owner can refresh, and the other way round hands them somebody else's plugins.
func (a blockOps) installedSet(ctx context.Context, ownerID string) map[string]bool {
	rows, err := a.assembly.ListInstalled(ctx, ownerID)
	if err != nil {
		return map[string]bool{}
	}
	out := make(map[string]bool, len(rows))
	for i := range rows {
		out[rows[i].BlockID] = true
	}
	return out
}

// seamConnected — whether the seam slot has an active, connected supplier. A read
// failure is treated as not connected: this is a display state, and shouldn't be able to
// break the whole table.
func (a blockOps) seamConnected(ctx context.Context, ownerID, seam string) bool {
	ok, err := a.suppliers.SeamConnected(ctx, ownerID, seam)
	return err == nil && ok
}

// registryRows — one row per **visitor-facing** block in the registry.
//
// owner-only ones aren't listed: the owner-enable gate only applies to visitor assembly, so
// giving them a toggle would be a toggle that does nothing.
func (a blockOps) registryRows(facts *blockFacts) []blockRow {
	fibers := a.registry.List()
	out := make([]blockRow, 0, len(fibers))
	for _, c := range fibers {
		if c.Shape() == registry.ShapeOwnerOnly {
			continue
		}
		id := c.ID()
		origin, _ := a.registry.OriginOf(id)
		// An owner-installed block belongs to the owner who installed it.
		//
		// The registry is one table for the whole process while `installed_blocks` is
		// per-owner, so without this every owner sees — and could toggle or delete —
		// every other owner's blocks. A single-owner instance never notices; the moment
		// there are two, "my plugins" would list somebody else's.
		if origin == registry.OriginOwner && !facts.installed[id] {
			continue
		}
		out = append(out, blockRow{
			ID: id, Title: blockTitleOf(c), Origin: string(origin), Kind: "block",
			Enabled: !facts.disabled[id], Deletable: origin.Deletable(),
			Dependency: dependencyOf(c, facts),
			Grants:     grantsOf(id),
		})
	}
	return out
}

func (a blockOps) deletable(id string) bool {
	if _, ok := a.registry.OriginOf(id); ok {
		return false
	}
	return !strings.HasPrefix(id, supplierRowPrefix)
}

func blockTitleOf(c registry.Fiber) string {
	if t, ok := c.(registry.Titled); ok {
		return t.Title()
	}
	return ""
}

// dependencyOf — which seam this block is waiting on, and whether that seam has a
// connected supplier. Declares nothing, or nothing this instance can supply → nil.
//
// The unmet one wins when a block names several: the row exists to tell the owner what to
// go and connect, and a met dependency has nothing to say.
//
// This was a switch on two block ids. A block names its seam in its own `requires:`, the
// seam names its supplier in that supplier's `provides:`, and the host reads both rather
// than holding a third copy that only covered the two blocks somebody remembered.
func dependencyOf(c registry.Fiber, facts *blockFacts) *blockDependency {
	rd, ok := c.(registry.RequiresDeps)
	if !ok {
		return nil
	}
	return pickDependency(rd.Requires(), facts)
}

// pickDependency — the unmet seam if this block has one, else the first met one, else nil.
// A seam no shipped supplier declares is skipped: the owner has nothing to go and connect.
func pickDependency(seams []string, facts *blockFacts) *blockDependency {
	declared := knownSeams(seams, facts)
	if len(declared) == 0 {
		return nil
	}
	for i := range declared {
		if !declared[i].Connected {
			return &declared[i]
		}
	}
	return &declared[0]
}

// knownSeams — the seams this block declares that something in this image actually
// supplies, each carrying whether the owner has connected it. A seam nothing supplies is
// dropped: the row exists to name something the owner can go and connect.
func knownSeams(seams []string, facts *blockFacts) []blockDependency {
	out := make([]blockDependency, 0, len(seams))
	for _, seam := range seams {
		if connected, known := facts.seams[seam]; known {
			out = append(out, blockDependency{Name: seamLabel(seam), Connected: connected})
		}
	}
	return out
}

// seamLabel — what the owner is told to connect: the supplier's declared title, or the
// bare seam name when it declared none.
func seamLabel(seam string) string {
	if t := seamTitles()[seam]; t != "" {
		return t
	}
	return seam
}

// supplierSlotRows — one row per platform-managed seam slot. Can be disabled, not
// deleted (disconnect, not delete).
//
// One row per seam a shipped supplier declares — not per supplier: the slot is what the
// owner fills, and two suppliers of one seam is refused upstream anyway.
func supplierSlotRows(facts *blockFacts) []blockRow {
	managed := string(registry.OriginManaged)
	seams := slices.Sorted(maps.Keys(facts.seams))
	out := make([]blockRow, 0, len(seams))
	for _, seam := range seams {
		connected := facts.seams[seam]
		label := seamLabel(seam)
		out = append(out, blockRow{
			ID: supplierRowID(seam), Title: label, Origin: managed, Kind: "supplier",
			Enabled: connected, Deletable: false, Grants: []string{},
			Dependency: &blockDependency{Name: label, Connected: connected},
		})
	}
	return out
}

// ownerSkillRows — one row per owner-authored skill.
//
// enabled reads **the skill's own** global toggle (the one the skill runner actually reads),
// not block_enabled — a skill isn't a registry block, so don't treat the
// owner-enable gate's table as its source of truth.
func ownerSkillRows(facts *blockFacts) []blockRow {
	out := make([]blockRow, 0, len(facts.skills))
	for i := range facts.skills {
		s := &facts.skills[i]
		if s.IsBuiltin {
			continue // a built-in skill doesn't count as owner-origin, and can't be deleted
		}
		// Title must be given: a skill's id is a UUID. A built-in block's id already
		// reads like plain language (mail.send), so rendering only the id looks fine — until
		// an owner-authored skill shows up, and that row is left as a string of hex digits
		// with a toggle and a delete button hanging next to it.
		out = append(out, blockRow{
			ID: s.ID, Title: s.Name, Origin: string(registry.OriginOwner), Kind: "skill",
			Enabled: s.Enabled, Deletable: true, Grants: []string{},
		})
	}
	return out
}
