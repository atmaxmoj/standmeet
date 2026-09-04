// boot_upgrade.go — construction, on the composition-root side, of the two external ports
// for the upgrade tile on /admin/system.
//
// One goes out over HTTP (asks the image registry whether a newer version exists); the
// other takes the deploy credential the owner filled in (asks the orchestrator to redeploy
// this instance). Neither belongs to the stats domain — the domain only sees two narrow
// ports.
//
// A separate file instead of stuffing this into boot_deps.go: that file already sits at
// the max-lines gate's limit, and "just a little more" is exactly how it got that way.

package main

import (
	"github.com/atmaxmoj/standmeet/cmd/server/config"
	"github.com/atmaxmoj/standmeet/cmd/server/port"

	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// upgradeSources — the side that asks the image registry + the side that asks someone
// to redeploy.
//
// An empty hook is **normal**, not a fault: for most deployment methods the upgrade
// step already happens outside the instance. Redeployer truthfully reports
// Configured()=false, and the panel renders the button as unclickable accordingly.
// upgradeSources also chooses the redeploy path: an explicit orchestrator webhook wins (an
// owner who set STANDMEET_REDEPLOY_HOOK means it); otherwise the product-owned updater-sidecar
// signal is the default, so the button works out of the box. Only when neither is present does
// Redeployer/SignalRedeployer report Configured()=false and the panel say it can't act.
func upgradeSources(cfg *config.Config) stats.UpgradeSources {
	src := stats.UpgradeSources{
		Releases: port.NewReleaseChannel(cfg.ReleaseRegistry, cfg.ReleaseRepo),
	}
	if cfg.RedeployHookURL != "" {
		src.Deploy = port.NewRedeployer(cfg.RedeployHookURL)
	} else {
		src.Deploy = port.NewSignalRedeployer(cfg.UpgradeSignalPath)
	}
	return src
}
