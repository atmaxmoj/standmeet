package main

import (
	"testing"

	"github.com/atmaxmoj/standmeet/cmd/server/config"
)

// TestUpgradeSourcesRedeployer — the composition root wires the redeploy side to the one
// substrate-blind signal path, never a fork the product chooses. A signal path (sidecar
// shipped) is Configured()=true so the button works out of the box; no path is
// Configured()=false — the honest "can't act" state that draws the button unclickable and
// must not lie true.
func TestUpgradeSourcesRedeployer(t *testing.T) {
	signalOnly := upgradeSources(&config.Config{
		UpgradeSignalPath: "/run/standmeet/upgrade.signal",
	})
	if !signalOnly.Deploy.Configured() {
		t.Fatal("signal path set (sidecar shipped) must be Configured()=true out of the box")
	}

	neither := upgradeSources(&config.Config{})
	if neither.Deploy.Configured() {
		t.Fatal("no signal path must be Configured()=false, not a lie")
	}
}
