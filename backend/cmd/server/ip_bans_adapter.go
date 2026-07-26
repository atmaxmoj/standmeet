package main

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/security"
)

// ipBanStoreAdapter —— postgres-free view of BannedIPRepo for the ownercore ip_bans capability
// (mirrors calendarStoreAdapter: keeps postgres types out of the plugin, builds the input here).
type ipBanStoreAdapter struct{ repo *security.BannedIPRepo }

func (a ipBanStoreAdapter) List(ctx context.Context, ownerID string) ([]security.BannedIP, error) {
	bans, err := a.repo.List(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list banned ips: %w", err)
	}
	return bans, nil
}

func (a ipBanStoreAdapter) Ban(
	ctx context.Context, ownerID, ip string, expiresAt *time.Time,
) (security.BannedIP, error) {
	in := &security.BanIPInput{OwnerID: ownerID, IP: ip, ExpiresAt: expiresAt}
	ban, err := a.repo.Ban(ctx, in)
	if err != nil {
		return security.BannedIP{}, fmt.Errorf("ban ip: %w", err)
	}
	return ban, nil
}

func (a ipBanStoreAdapter) Unban(ctx context.Context, ownerID, id string) error {
	if err := a.repo.Unban(ctx, ownerID, id); err != nil {
		return fmt.Errorf("unban ip: %w", err)
	}
	return nil
}
