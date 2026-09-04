package main

import (
	"testing"

	"github.com/atmaxmoj/standmeet/cmd/server/config"
)

// TestUpgradeSourcesPicksRedeployer — the composition root must default to the product-owned
// signal path (so the upgrade button works out of the box), let an explicit orchestrator
// webhook win when the owner set one, and report Configured()=false only when the owner has
// neither. That last branch is what draws the button as "can't act" — it must not lie true.
func TestUpgradeSourcesPicksRedeployer(t *testing.T) {
	// Product default: sidecar shipped (signal path set), no webhook → can_apply true out of
	// the box.
	signalOnly := upgradeSources(&config.Config{
		UpgradeSignalPath: "/run/standmeet/upgrade.signal",
	})
	if !signalOnly.Deploy.Configured() {
		t.Fatal("signal path set (sidecar shipped) must be Configured()=true out of the box")
	}

	// Advanced owner set an explicit webhook: it wins even if a signal path is also present.
	webhook := upgradeSources(&config.Config{
		RedeployHookURL:   "https://orchestrator.example/deploy/abc",
		UpgradeSignalPath: "/run/standmeet/upgrade.signal",
	})
	if !webhook.Deploy.Configured() {
		t.Fatal("an explicit redeploy webhook must be Configured()=true")
	}

	// Neither: the honest can't-act state.
	neither := upgradeSources(&config.Config{})
	if neither.Deploy.Configured() {
		t.Fatal("no webhook and no signal path must be Configured()=false, not a lie")
	}
}
