// block_delete.go — deleting a block from the panel: uninstall an owner-installed block (drop its
// schema, delete the row, warn if it held data) or delete an owner-authored skill. Split from
// table.go, which assembles the listing; deletion is a mutation with its own reasoning (the
// data-loss warning, the drop-before-row ordering) and was pushing table.go past the line ceiling.

package blockwire

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockwarn"
)

// Delete — only an owner-authored skill or an owner-installed block can be deleted. Registry
// blocks (builtin/managed) and supplier rows are both rejected.
func (a blockOps) Delete(ctx context.Context, ownerID, id string) error {
	// A block the owner installed is deletable, and deleting it means uninstalling it.
	//
	// This branch is why the row's `deletable` and this method can be trusted to agree.
	// Before owners could install blocks, every registry entry was built in and the two
	// answers matched by accident: the row said `origin.Deletable()` while this method
	// refused anything the registry knew. An installed block is origin=owner, so the
	// panel offered a delete button that always failed — a control that lies.
	if a.ownerInstalled(id) {
		// Refuse if a fiber relies on this block: it provides a seam another installed block
		// requires. Delete drops the schema and the row — irreversible — so a relied-upon block
		// must not go, or its dependents are left with an unmet dependency and no undo. This is
		// stronger than the disable toggle's relied-lock (that switch is reversible; this is not).
		dep := plugin.RequiredBy(currentManifestSet(ctx, a.assembly, ownerID), id)
		if len(dep) > 0 {
			return fp.BadInput(fmt.Sprintf(
				"cannot delete %q: %s relies on it — remove the dependent first",
				id, strings.Join(dep, ", ")))
		}
		return a.uninstall(ctx, ownerID, id)
	}
	if !a.deletable(id) {
		return fp.BadInput("this block is built in and cannot be deleted")
	}
	if err := a.skills.Delete(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete owner skill: %w", err)
	}
	return nil
}

// uninstall — remove an owner-installed block: drop its schema, then delete the row.
//
// The schema name is recomputed from the durable binding (the block id), not held in
// memory — a remount would find the same id → same schema (design rule "persistence").
// Drop first so a failed drop leaves the row installed and the uninstall retriable; the
// drop is idempotent (DROP SCHEMA IF EXISTS), so a block that had no schema is a no-op.
// This closes the orphan-schema leak: Uninstall used to delete only the installed_blocks
// row (the measured `mcp_acme_widget_zzfixture` leak). See everything-is-a-block.md rule 3.
func (a blockOps) uninstall(ctx context.Context, ownerID, id string) error {
	// Count the records the drop will destroy BEFORE dropping. A block that held data must not
	// lose it silently: after the drop we raise a persistent data-loss warning the owner sees in
	// admin (everything-is-a-block.md rule 3, "warns of data loss — and the warning is a block
	// too"). Count failure is not fatal to the uninstall — a missing warning must never block the
	// delete the owner asked for; it is logged as best-effort.
	held, cerr := a.store.CountAll(ctx, blockstore.KindMCP, id)
	if cerr != nil {
		held = 0 // count failed → skip the warning rather than block the delete the owner asked for
	}
	if err := a.store.Drop(ctx, blockstore.KindMCP, id); err != nil {
		return fmt.Errorf("drop block schema: %w", err)
	}
	if err := a.assembly.Uninstall(ctx, ownerID, id); err != nil {
		return fmt.Errorf("uninstall block: %w", err)
	}
	if held > 0 {
		a.raiseDataLoss(ctx, ownerID, id, held)
	}
	return nil
}

// raiseDataLoss — record the persistent warning; best-effort (a warning that fails to store must
// not fail the delete the owner already asked for and which already happened).
func (a blockOps) raiseDataLoss(ctx context.Context, ownerID, id string, records int64) {
	msg := fmt.Sprintf("Uninstalling %q permanently dropped %d stored record(s).", id, records)
	if err := a.warn.Raise(ctx, ownerID, blockwarn.Warning{
		Kind: blockwarn.KindDataLoss, BlockID: id, Message: msg,
	}); err != nil {
		slog.Default().Warn("data-loss warning not recorded", "block", id, "err", err)
	}
}
