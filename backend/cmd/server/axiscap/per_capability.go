// per_capability.go —— 交给入站收口的那份"这个能力自己的东西":它的隔离存储和它的配置。
//
// 在能力轴这边构造,而不是在收口那边:绑死到哪个命名空间是**能力轴的知识**,收口只负责
// 把各处交上来的 op 汇起来发单。

package axiscap

import (
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/routes/hostdesk"
)

// PerCapabilityDeps —— 一个能力**自己的**存储和配置。
//
// 存储在构造期就绑死到这个能力的命名空间(schema = mcp_<id>),沙箱那侧填不了别人的表。
// 要不要 provision 由 needsStorage 一处判定 —— 见 storage.go。
func PerCapabilityDeps(d *deps.Runtime, m *mcpplugin.Manifest) *hostdesk.PerCapability {
	per := &hostdesk.PerCapability{}
	store := CapabilityStorage(d, m)
	if store == nil {
		return per
	}
	if wantsAny(m, "capstore.") {
		per.Store = boundCapStore{store: store, kind: capstore.KindMCP, id: m.ID}
	}
	if len(m.Config) > 0 {
		per.Config = boundCapConfig{cfg: CapConfigFor(store, m.ID), decl: m.Config}
	}
	return per
}
