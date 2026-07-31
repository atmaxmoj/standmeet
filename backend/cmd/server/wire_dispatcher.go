// wire_dispatcher.go —— 建出站收口:把各域 facade 的普通函数适配成 Op,汇成一处。
//
// 迁移期这份清单会一直长:每把一个资源搬进来,ownercore 就少注册一组,直到 ownercore 整包删除。
// 清单本身就是"这台实例对外能做什么"的全集 —— 它是交付物,不是脚手架。
//
// 装饰器(鉴权/配额/审计/危险操作)统一挂在这里:每个面拿能力都只能经收口,所以策略有唯一的
// 施加点,不会出现"某个 endpoint 忘了加"。

package main

import (
	"context"
	"fmt"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
)

// buildDispatcher —— 组装出站收口。
func buildDispatcher(d *runtimeDeps) *dispatcher.Dispatcher {
	return dispatcher.New(
		dispatcher.IPBans(ipBanOps{repo: d.bannedIPRepo}),
	)
}

// adminFace —— admin HTTP 面在 parity 里的档案。它是浏览器应用,所以能承载浏览器流程、
// 明文密钥、multipart 这三类 MCP 承载不了的东西(Reach 的 .Except(...) 据此放行)。
func adminFace(d *dispatcher.Dispatcher) *dispatcher.Face {
	return d.Attach(fp.Facade{
		Name: "admin", Plane: fp.PlaneOwner, ServesRead: true, ServesActn: true,
		CanCarry: []fp.FacadeClass{fp.Browser, fp.SecretBearing, fp.Multipart},
	})
}

// ipBanOps —— security 仓储 → 收口要的窄口。收口不认识 security 的实体类型,这里做形状转换:
// 域保持协议无关,协议层保持域无关,转换只此一处。
type ipBanOps struct{ repo *security.BannedIPRepo }

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
