// access.go —— composition root 把 owner.Repo 适配成 access 模块的窄端口。
// access 只需要"sole owner 的 id",不该依赖整个 owner.Repo；这里满足 access.SoleOwnerLookup。

package port

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// SoleOwnerLookup —— access.SoleOwnerLookup 的实现：复用 owner.LoadSoleOwner 取 sole owner 的 id。
type SoleOwnerLookup struct {
	owners *owner.Repo
}

// NewSoleOwnerLookup —— 构造。字段不导出:别处只该拿到一个能问 "sole owner 是谁" 的口子。
func NewSoleOwnerLookup(d *deps.Runtime) SoleOwnerLookup {
	return SoleOwnerLookup{owners: d.OwnerRepo}
}

// SoleOwnerID —— 单 owner instance:返回已 claim 的 sole owner id;未 claim 时透传 owner 的错误。
func (s SoleOwnerLookup) SoleOwnerID(ctx context.Context) (string, error) {
	o, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: s.owners})
	if err != nil {
		return "", fmt.Errorf("load sole owner: %w", err)
	}
	return o.ID, nil
}

// RecoveryDeps —— #100 account recovery 的窄依赖(owner repo + session store + mail proxy)。
func RecoveryDeps(d *deps.Runtime) owner.RecoveryDeps {
	return owner.RecoveryDeps{
		Owners: d.OwnerRepo, Sessions: d.SessionStore, Proxy: OutboundSender(d),
	}
}
