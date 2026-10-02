// bound_store.go — the generic blockstore.Store bound to one block, routed per fiber (rule 3,
// docs/design/plugin/per-fiber-schema.md, Execution plan).
//
// Every op arrives with the fiber its native key resolved to (hostop.CallerFiber), never a fiber
// the block wrote. Three routes:
//
//	visitor fiber (b_<bundle> / root_<owner>)  its own schema, <fiber>_<block>, made on first use
//	owner fiber (owner_<owner>)                 writes go to the owner's root fiber; reads, counts
//	                                            and deletes span every fiber of the owner that
//	                                            exists
//	no fiber (no key verified, eval)            the block's legacy single schema
//
// Claims never split by fiber: they live in the block's legacy schema, so two bundles' visitors
// racing for one slot still have one winner (F-B-15). A claim key names its own scope (the booker
// puts the owner in it).

package blockwire

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/plugin/assembly"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
	"github.com/atmaxmoj/standmeet/internal/routes/blockdesk"
)

type boundBlockStore struct {
	// ownerFibers — every visitor fiber the owner has: the root fiber and one per bundle.
	ownerFibers func(ctx context.Context, ownerID string) ([]string, error)
	store       *blockstore.Store
	kind        blockstore.Kind
	blockID     string
}

func newBoundBlockStore(d *deps.Runtime, store *blockstore.Store, blockID string) boundBlockStore {
	return boundBlockStore{
		store: store, kind: blockstore.KindMCP, blockID: blockID,
		ownerFibers: func(ctx context.Context, ownerID string) ([]string, error) {
			return OwnerFibers(ctx, d.Assembly, ownerID)
		},
	}
}

// OwnerFibers — the owner's visitor fibers: root first, then each bundle's.
func OwnerFibers(ctx context.Context, asm *assembly.Repo, ownerID string) ([]string, error) {
	bundles, err := asm.ListBundles(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("owner fibers: %w", err)
	}
	out := make([]string, 0, len(bundles)+1)
	out = append(out, registry.RootFiber(ownerID))
	for i := range bundles {
		out = append(out, registry.BundleFiber(bundles[i].ID))
	}
	return out, nil
}

func (b boundBlockStore) Insert(
	ctx context.Context, fiber, collection string, doc json.RawMessage,
) (string, error) {
	sid, eerr := b.writeSchema(ctx, fiber)
	if eerr != nil {
		return "", eerr
	}
	id, err := b.store.Insert(ctx, b.kind, sid, collection, doc)
	if err != nil {
		return "", fmt.Errorf("blockstore insert: %w", err)
	}
	return id, nil
}

func (b boundBlockStore) Query(
	ctx context.Context, fiber, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	sids, serr := b.readSchemas(ctx, fiber)
	if serr != nil {
		return nil, serr
	}
	out := []json.RawMessage{}
	for _, sid := range sids {
		docs, err := b.store.Query(ctx, b.kind, sid, collection, filter)
		if err != nil {
			return nil, fmt.Errorf("blockstore query: %w", err)
		}
		out = append(out, docs...)
	}
	return out, nil
}

func (b boundBlockStore) Count(
	ctx context.Context, fiber, collection string, filter json.RawMessage,
) (int64, error) {
	sids, serr := b.readSchemas(ctx, fiber)
	if serr != nil {
		return 0, serr
	}
	var total int64
	for _, sid := range sids {
		n, err := b.store.Count(ctx, b.kind, sid, collection, filter)
		if err != nil {
			return 0, fmt.Errorf("blockstore count: %w", err)
		}
		total += n
	}
	return total, nil
}

func (b boundBlockStore) Delete(
	ctx context.Context, fiber, collection string, filter json.RawMessage,
) (int64, error) {
	sids, serr := b.readSchemas(ctx, fiber)
	if serr != nil {
		return 0, serr
	}
	var total int64
	for _, sid := range sids {
		n, err := b.store.Delete(ctx, b.kind, sid, collection, filter)
		if err != nil {
			return 0, fmt.Errorf("blockstore delete: %w", err)
		}
		total += n
	}
	return total, nil
}

// QueryRecords / DeleteByID — reads that include the record id, and delete by that id. If a
// block can't reach its own records' ids, a duplicate is bound to grow somewhere else (see the
// note on blockdesk.BoundStore).
func (b boundBlockStore) QueryRecords(
	ctx context.Context, fiber, collection string, filter json.RawMessage,
) ([]blockdesk.BoundRecord, error) {
	sids, serr := b.readSchemas(ctx, fiber)
	if serr != nil {
		return nil, serr
	}
	out := []blockdesk.BoundRecord{}
	for _, sid := range sids {
		recs, err := b.store.QueryWithIDs(ctx, b.kind, sid, collection, filter)
		if err != nil {
			return nil, fmt.Errorf("blockstore query records: %w", err)
		}
		for i := range recs {
			out = append(out, blockdesk.BoundRecord{ID: recs[i].ID, Doc: recs[i].Doc})
		}
	}
	return out, nil
}

// DeleteByID — the record id is a uuid, unique across schemas: the first schema that holds it is
// the only one.
func (b boundBlockStore) DeleteByID(
	ctx context.Context, fiber, collection, recordID string,
) (int64, error) {
	sids, serr := b.readSchemas(ctx, fiber)
	if serr != nil {
		return 0, serr
	}
	for _, sid := range sids {
		n, err := b.store.DeleteByID(ctx, b.kind, sid, collection, recordID)
		if err != nil {
			return 0, fmt.Errorf("blockstore delete by id: %w", err)
		}
		if n > 0 {
			return n, nil
		}
	}
	return 0, nil
}

// Claim / Release — single-winner locking (F-B-15), in the block's legacy schema whatever the
// fiber: a slot is one slot for every fiber.
func (b boundBlockStore) Claim(
	ctx context.Context, _, collection, key string, ttlSeconds int,
) (bool, error) {
	got, err := b.store.Claim(ctx, blockstore.ClaimKey{
		Kind: b.kind, ID: b.blockID, Collection: collection, Key: key,
	}, time.Duration(ttlSeconds)*time.Second)
	if err != nil {
		return false, fmt.Errorf("blockstore claim: %w", err)
	}
	return got, nil
}

func (b boundBlockStore) Release(ctx context.Context, _, collection, key string) error {
	if err := b.store.Release(ctx, blockstore.ClaimKey{
		Kind: b.kind, ID: b.blockID, Collection: collection, Key: key,
	}); err != nil {
		return fmt.Errorf("blockstore release: %w", err)
	}
	return nil
}

// writeSchema — where a write by this fiber lands (provisioned).
func (b boundBlockStore) writeSchema(ctx context.Context, fiber string) (string, error) {
	if owner, ok := registry.OwnerOfOwnerFiber(fiber); ok {
		fiber = registry.RootFiber(owner)
	}
	sid := blockstore.FiberSchemaID(fiber, b.blockID)
	if err := b.store.EnsureProvisioned(ctx, b.kind, sid); err != nil {
		return "", fmt.Errorf("blockstore ensure %q: %w", sid, err)
	}
	return sid, nil
}

// readSchemas — every schema a read by this fiber covers.
func (b boundBlockStore) readSchemas(ctx context.Context, fiber string) ([]string, error) {
	owner, ok := registry.OwnerOfOwnerFiber(fiber)
	if !ok {
		sid, err := b.writeSchema(ctx, fiber)
		if err != nil {
			return nil, err
		}
		return []string{sid}, nil
	}
	return b.ownerSchemas(ctx, owner)
}

// ownerSchemas — the schemas of this block that exist among the owner's fibers.
func (b boundBlockStore) ownerSchemas(ctx context.Context, owner string) ([]string, error) {
	fibers, err := b.ownerFibers(ctx, owner)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(fibers))
	for _, f := range fibers {
		ids = append(ids, blockstore.FiberSchemaID(f, b.blockID))
	}
	existing, eerr := b.store.Existing(ctx, b.kind, ids)
	if eerr != nil {
		return nil, fmt.Errorf("blockstore fan-out: %w", eerr)
	}
	return existing, nil
}
