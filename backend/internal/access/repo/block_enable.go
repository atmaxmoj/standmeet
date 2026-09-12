// block_enable.go —— Phase H: CRUD for the per-(owner, block) owner-enable
// switch. Stores only the "explicitly turned off" preference; no row = enabled by default.
// DisabledSet feeds the registry's EnableGate (the visitor-assembly gate); SetEnabled feeds
// the admin PATCH.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// BlockEnableRepo —— reads and writes the block_enabled table.
type BlockEnableRepo struct {
	pool *pgstore.Pool
}

// NewBlockEnableRepo constructs a BlockEnableRepo.
func NewBlockEnableRepo(pool *pgstore.Pool) *BlockEnableRepo { return &BlockEnableRepo{pool: pool} }

// SetEnabled —— upserts an owner's switch for one block. Concurrency-safe
// (PK conflict does DO UPDATE).
func (r *BlockEnableRepo) SetEnabled(
	ctx context.Context, ownerID, blockID string, enabled bool,
) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if uerr := db.New(r.pool).UpsertBlockEnabled(ctx, db.UpsertBlockEnabledParams{
		OwnerID: ownerUUID, BlockID: blockID, Enabled: enabled,
	}); uerr != nil {
		return fmt.Errorf("upsert block enabled: %w", uerr)
	}
	return nil
}

// DisabledSet —— the set of block IDs the owner explicitly turned off
// (enabled=false). The registry's EnableGate uses it to strip these blocks out
// of visitor assembly.
func (r *BlockEnableRepo) DisabledSet(
	ctx context.Context, ownerID string,
) (map[string]bool, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListBlockEnabled(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list block enabled: %w", qerr)
	}
	out := make(map[string]bool, len(rows))
	for _, row := range rows {
		if !row.Enabled {
			out[row.BlockID] = true
		}
	}
	return out, nil
}
