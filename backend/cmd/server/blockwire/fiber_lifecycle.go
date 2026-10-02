// fiber_lifecycle.go — dropping per-fiber schemas when what owns them goes away
// (docs/design/plugin/per-fiber-schema.md, checkpoint 5).
//
//	uninstall a block  → the block's legacy schema and every fiber of it the owner has
//	delete a bundle    → the bundle's fiber of every storing block
//
// A bundle's fiber is looked for in every storing block, not only the bundle's current members:
// a block taken out of the bundle earlier left its schema behind, and it goes with the bundle too.
// Every drop that destroyed records raises the persistent data-loss warning (item 9).

package blockwire

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockwarn"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// blockSchemaIDs — every schema id one block may hold for this owner: legacy, then each fiber.
func (a blockOps) blockSchemaIDs(ctx context.Context, ownerID, blockID string) []string {
	ids := []string{blockID}
	fibers, err := OwnerFibers(ctx, a.assembly, ownerID)
	if err != nil {
		slog.Default().Warn("list owner fibers for uninstall", "block", blockID, "err", err)
		return ids
	}
	for _, f := range fibers {
		ids = append(ids, blockstore.FiberSchemaID(f, blockID))
	}
	return ids
}

// dropSchemas — drop each existing schema among ids; returns how many records went with them. A
// count failure is not fatal: the drop the owner asked for still happens, without its warning.
func (a blockOps) dropSchemas(ctx context.Context, ids []string) (int64, error) {
	existing, err := a.store.Existing(ctx, blockstore.KindMCP, ids)
	if err != nil {
		return 0, fmt.Errorf("find block schemas: %w", err)
	}
	var held int64
	for _, id := range existing {
		if n, cerr := a.store.CountAll(ctx, blockstore.KindMCP, id); cerr == nil {
			held += n
		}
		if derr := a.store.Drop(ctx, blockstore.KindMCP, id); derr != nil {
			return held, fmt.Errorf("drop block schema: %w", derr)
		}
	}
	return held, nil
}

// dropBundleFibers — drop a deleted bundle's fiber of every storing block, warning per block whose
// records went.
func dropBundleFibers(ctx context.Context, d *deps.Runtime, ownerID, bundleID, bundleName string) {
	a := newBlockOps(d)
	fiber := registry.BundleFiber(bundleID)
	for blockID := range d.BlockStores {
		held, err := a.dropSchemas(ctx, []string{blockstore.FiberSchemaID(fiber, blockID)})
		if err != nil {
			slog.Default().Error("drop bundle fiber",
				"bundle", bundleID, "block", blockID, "err", err)
			continue
		}
		if held > 0 {
			a.raise(ctx, ownerID, blockID, fmt.Sprintf(
				"Deleting bundle %q permanently dropped %d stored record(s) of %q.",
				bundleName, held, blockID))
		}
	}
}

// raise — record a data-loss warning; best-effort (the drop already happened).
func (a blockOps) raise(ctx context.Context, ownerID, blockID, msg string) {
	if err := a.warn.Raise(ctx, ownerID, blockwarn.Warning{
		Kind: blockwarn.KindDataLoss, BlockID: blockID, Message: msg,
	}); err != nil {
		slog.Default().Warn("data-loss warning not recorded", "block", blockID, "err", err)
	}
}
