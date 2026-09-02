// capability_settings.go —— Phase H: CRUD for the per-(owner, capability) owner-enable
// switch. Stores only the "explicitly turned off" preference; no row = enabled by default.
// DisabledSet feeds capreg's EnableGate (the visitor-assembly gate); SetEnabled feeds the
// admin PATCH.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// CapabilityRepo —— reads and writes the capability_settings table.
type CapabilityRepo struct {
	pool *pgstore.Pool
}

// NewCapabilityRepo constructs a CapabilityRepo.
func NewCapabilityRepo(pool *pgstore.Pool) *CapabilityRepo { return &CapabilityRepo{pool: pool} }

// SetEnabled —— upserts an owner's switch for one capability. Concurrency-safe
// (PK conflict does DO UPDATE).
func (r *CapabilityRepo) SetEnabled(
	ctx context.Context, ownerID, capabilityID string, enabled bool,
) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if uerr := db.New(r.pool).UpsertCapabilitySetting(ctx, db.UpsertCapabilitySettingParams{
		OwnerID: ownerUUID, CapabilityID: capabilityID, Enabled: enabled,
	}); uerr != nil {
		return fmt.Errorf("upsert capability setting: %w", uerr)
	}
	return nil
}

// DisabledSet —— the set of capability IDs the owner explicitly turned off
// (enabled=false). capreg.EnableGate uses it to strip these capabilities out
// of visitor assembly.
func (r *CapabilityRepo) DisabledSet(
	ctx context.Context, ownerID string,
) (map[string]bool, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListCapabilitySettings(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list capability settings: %w", qerr)
	}
	out := make(map[string]bool, len(rows))
	for _, row := range rows {
		if !row.Enabled {
			out[row.CapabilityID] = true
		}
	}
	return out, nil
}
