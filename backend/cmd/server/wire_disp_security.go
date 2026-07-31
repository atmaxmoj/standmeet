// wire_disp_security.go —— security 域的普通函数 → 出站收口的窄口(ip_bans)。

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
)

// ipBanOps —— security 仓储 → 收口要的窄口。收口不认识 security 的实体类型,这里做形状转换:
// 域保持协议无关,协议层保持域无关,转换只此一处。
type ipBanOps struct{ repo *security.BannedIPRepo }

func newIPBanOps(d *runtimeDeps) ipBanOps { return ipBanOps{repo: d.bannedIPRepo} }

func (a ipBanOps) List(ctx context.Context, ownerID string) ([]dispatcher.IPBan, error) {
	bans, err := a.repo.List(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list banned ips: %w", err)
	}
	out := make([]dispatcher.IPBan, 0, len(bans))
	for i := range bans {
		out = append(out, toDispatcherIPBan(&bans[i]))
	}
	return out, nil
}

func (a ipBanOps) Ban(ctx context.Context, in *dispatcher.BanIP) (dispatcher.IPBan, error) {
	ban, err := a.repo.Ban(ctx, &security.BanIPInput{
		OwnerID: in.OwnerID, IP: in.IP, Reason: in.Reason, ExpiresAt: in.ExpiresAt,
	})
	if err != nil {
		return dispatcher.IPBan{}, fmt.Errorf("ban ip: %w", err)
	}
	return toDispatcherIPBan(&ban), nil
}

func (a ipBanOps) Unban(ctx context.Context, ownerID, id string) error {
	if err := a.repo.Unban(ctx, ownerID, id); err != nil {
		return fmt.Errorf("unban ip: %w", err)
	}
	return nil
}

func toDispatcherIPBan(b *security.BannedIP) dispatcher.IPBan {
	return dispatcher.IPBan{
		ID: b.ID, IP: b.IP, Reason: b.Reason,
		CreatedAt: b.CreatedAt, ExpiresAt: b.ExpiresAt,
	}
}
