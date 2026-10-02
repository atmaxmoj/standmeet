// fiber_migrate.go — the upgrade to per-fiber storage (docs/design/plugin/per-fiber-schema.md,
// checkpoint 6).
//
// Before it, every storing block kept one schema, mcp_<block>, for everyone. After it, a visitor's
// records live in its fiber's schema and the owner's reads span the owner's fibers — which never
// include the legacy schema. So the legacy schema's records move to the owner's root fiber, where
// a no-bundle visitor (what every visitor was, before bundles) now writes. Config collections stay:
// config is still read from the legacy schema. Claims stay too (they are their own table).
//
// Runs at every boot and is a no-op once moved. Only on a one-owner instance: a legacy record
// carries no owner the host could route it by, and v1 instances have exactly one.

package blockwire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockconfig"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// MigrateLegacyFiberRows — move each storing block's legacy records to the sole owner's root fiber.
func MigrateLegacyFiberRows(ctx context.Context, d *deps.Runtime, owner string) {
	for blockID, store := range d.BlockStores {
		root := blockstore.FiberSchemaID(registry.RootFiber(owner), blockID)
		n, err := store.MoveRecords(
			ctx, blockstore.KindMCP, blockID, root, blockconfig.CollectionPrefix)
		if err != nil {
			d.Log.Error("per-fiber upgrade: move legacy records", "block", blockID, "err", err)
			continue
		}
		if n > 0 {
			d.Log.Info("per-fiber upgrade: moved legacy records", "block", blockID, "records", n)
		}
	}
}
