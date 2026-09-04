// boot_upgrade.go — construction, on the composition-root side, of the two external ports
// for the upgrade tile on /admin/system.
//
// One goes out over HTTP (asks the image registry whether a newer version exists); the
// other emits a substrate-blind redeploy pulse (a byte on a shared volume). Neither belongs
// to the stats domain — the domain only sees two narrow ports.
//
// A separate file instead of stuffing this into boot_deps.go: that file already sits at
// the max-lines gate's limit, and "just a little more" is exactly how it got that way.

package main

import (
	"github.com/atmaxmoj/standmeet/cmd/server/config"
	"github.com/atmaxmoj/standmeet/cmd/server/port"

	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// upgradeSources — the side that asks the image registry + the side that presses "redeploy".
//
// The redeploy side is **one** thing, never a fork the product chooses: it always writes the
// substrate-blind signal. The product must not know whether it sits on bare compose, Coolify,
// or anything else — that knowledge lives entirely in whichever adapter consumes the signal
// (the docker updater sidecar; a Coolify sidecar would read the same pulse and call Coolify).
// An empty signal path is **normal**, not a fault: when no adapter shipped, SignalRedeployer
// reports Configured()=false and the panel renders the button as unclickable, saying the
// upgrade happens outside the instance.
func upgradeSources(cfg *config.Config) stats.UpgradeSources {
	return stats.UpgradeSources{
		Releases: port.NewReleaseChannel(cfg.ReleaseRegistry, cfg.ReleaseRepo),
		Deploy:   port.NewSignalRedeployer(cfg.UpgradeSignalPath),
	}
}
