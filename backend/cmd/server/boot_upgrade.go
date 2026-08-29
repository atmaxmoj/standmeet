// boot_upgrade.go —— /admin/system 升级那一格的两个外部口在组装根这一头的构造。
//
// 一个走出站 HTTP(问镜像库还有没有更新的版本),一个拿的是 owner 填的部署凭据
// (请编排方重新部署这台实例)。两件都不属于 stats 域 —— 域只见两个窄口。
//
// 单独一个文件而不是塞进 boot_deps.go:那个文件已经到了 max-lines 闸门的线上,
// 而"再挤一点点"正是它变成现在这样的过程。

package main

import (
	"github.com/atmaxmoj/standmeet/cmd/server/config"
	"github.com/atmaxmoj/standmeet/cmd/server/port"

	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// upgradeSources —— 问镜像库的那一头 + 请人重新部署的那一头。
//
// hook 为空是**常态**,不是故障:大多数部署方式下,升级本来就是在实例外面做的。
// Redeployer 自己会如实回答 Configured()=false,面板据此不把按钮画成能按的样子。
func upgradeSources(cfg *config.Config) stats.UpgradeSources {
	return stats.UpgradeSources{
		Releases: port.NewReleaseChannel(cfg.ReleaseRegistry, cfg.ReleaseRepo),
		Deploy:   port.NewRedeployer(cfg.RedeployHookURL),
	}
}
