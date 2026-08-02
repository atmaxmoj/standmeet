// dep_registry.go —— 品类依赖注册表:拉起时把内置连接器装进 Hub,并让"这个品类连上了没有"
// 这件事有个可问的地方。能力那边用它决定一个声明了 Requires 的能力露不露。

package axisconn

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// DepRegistry —— 命名 connector 依赖 provider 注册表。#155：拉起时 discovery 把内置
// 连接器装配进 Hub，品类 dep 由 slot 分派器背书（active 连接器 connected 才放行）。provider
// 只暴露「这个 owner 连没连」，凭据全程留在 connector 层内（句柄非凭据）。
func DepRegistry(ctx context.Context, d *deps.Runtime) *capreg.DepRegistry {
	depReg := capreg.NewDepRegistry()
	if err := RegisterDiscoveredConnectors(ctx, d, depReg); err != nil {
		d.Log.Error("register discovered connectors", "err", err)
	}
	return depReg
}
