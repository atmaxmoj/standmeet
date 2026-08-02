// port_access.go —— composition root 把 owner.Repo 适配成 access 模块的窄端口。
// access 只需要"sole owner 的 id",不该依赖整个 owner.Repo；这里满足 access.SoleOwnerLookup。

package main

import (
	"context"
	"fmt"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// soleOwnerLookup —— access.SoleOwnerLookup 的实现：复用 owner.LoadSoleOwner 取 sole owner 的 id。
type soleOwnerLookup struct {
	owners *owner.Repo
}

// SoleOwnerID —— 单 owner instance:返回已 claim 的 sole owner id;未 claim 时透传 owner 的错误。
func (s soleOwnerLookup) SoleOwnerID(ctx context.Context) (string, error) {
	o, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: s.owners})
	if err != nil {
		return "", fmt.Errorf("load sole owner: %w", err)
	}
	return o.ID, nil
}
