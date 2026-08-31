// builtin_roles.go —— boot 时把 builtin role 补齐给**已经存在**的 owner。
//
// 种子本来只在 claim 时跑一次。加一个新的 builtin（`invited`）之后，那意味着已经部署的实例
// 升级完就少一条 —— 而少的那条正是发码时的默认档，于是 owner 一发码就撞上「invited role:
// not found」。功能在新实例上完好、在**所有老实例上**坏掉，是最难发现的一种坏法。
//
// SeedPublicRole 全程是 upsert（prompt / role / role_corpus_uris 都幂等），所以每次启动跑一遍
// 是安全的，而且顺带把 F-D-7 那三条遗留 glob 从老实例的 public 上清掉。

package wire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// BuiltinRoles —— 对本实例那个 owner 重跑一次 builtin 种子。best-effort：
// 未 claim（还没有 owner）直接跳过；失败只记日志，不挡启动。
func BuiltinRoles(ctx context.Context, d *deps.Runtime) {
	soleOwner, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: d.OwnerRepo})
	if err != nil {
		return // 还没 claim → 没有 owner 可种；claim 那条路自己会种
	}
	if serr := owner.SeedPublicRole(ctx, d.PromptRepo, d.RoleRepo, soleOwner.ID); serr != nil {
		d.Log.Error("reseed builtin roles at boot", "owner_id", soleOwner.ID, "err", serr)
	}
	// 插件那份同理:加一个新的插件 builtin 之后,**已经部署的实例**升级完会少一条,
	// 而少的那条正是发码时要挂的档 —— 功能在新实例上完好、在所有老实例上坏掉。
	if perr := d.PluginRegistry.SeedAllOwners(ctx, soleOwner.ID); perr != nil {
		d.Log.Error("reseed plugin builtins at boot", "owner_id", soleOwner.ID, "err", perr)
	}
}
