// capability_settings.go —— Phase H: per-(owner, capability) 的 owner-enable
// 开关 CRUD。只存「显式关掉」的偏好；没行 = 默认开。
// DisabledSet 给 capreg 的 EnableGate（访客装配闸）；SetEnabled 给 admin PATCH。

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// CapabilityRepo —— capability_settings 表读写。
type CapabilityRepo struct {
	pool *pgstore.Pool
}

// NewCapabilityRepo 构造 CapabilityRepo。
func NewCapabilityRepo(pool *pgstore.Pool) *CapabilityRepo { return &CapabilityRepo{pool: pool} }

// SetEnabled —— upsert owner 对某 capability 的开关。并发安全（PK 冲突 DO UPDATE）。
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

// DisabledSet —— owner 显式关掉（enabled=false）的 capability ID 集合。
// capreg.EnableGate 用它把这些 capability 从访客装配里摘掉。
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
