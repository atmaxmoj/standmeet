// upgrade_signal.go — the **product-owned, substrate-blind** redeploy path, and the only one.
//
// Pressing "redeploy" writes a byte to a file on a volume the app shares with an updater
// sidecar (infra/updater). The app never learns how it is deployed: whichever adapter consumes
// the signal owns that knowledge — the docker updater runs `docker compose up`; a Coolify
// adapter would read the same pulse and call Coolify's API. The app writes the byte and stops.
//
// The app stays **docker.sock-free**: all host privilege lives in the one small sidecar, off
// the internet-facing surface. can_apply is true out of the box because the sidecar ships with
// the compose and sets the signal path; with no sidecar, Configured() is false and the panel
// says the upgrade happens outside the instance.

package port

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

// ErrRedeployNotConfigured — no updater sidecar shipped, so there is no signal path to write.
// This isn't a fault: under some deployment methods upgrading is done outside the instance. The
// panel must **say exactly that**, and must not draw the button as if it were pressable.
var ErrRedeployNotConfigured = errors.New("no redeploy signal path for this instance")

// signalPerm — owner-only: the signal sits on a shared volume; nothing but the updater needs
// to read it, and nothing but us writes it.
const signalPerm = 0o600

// SignalRedeployer — writes an upgrade signal to signalPath (a file on the volume shared
// with the updater sidecar). Configured when the sidecar is present (the path is set).
type SignalRedeployer struct {
	now        func() time.Time
	signalPath string
}

// NewSignalRedeployer — signalPath is STANDMEET_UPGRADE_SIGNAL, set by the compose to a
// file on the updater-shared volume. Empty (no sidecar) → Configured() is false, and the
// panel reports the button can't act.
func NewSignalRedeployer(signalPath string) *SignalRedeployer {
	return &SignalRedeployer{signalPath: signalPath, now: time.Now}
}

// Configured — the sidecar shipped and gave us a signal path to write to.
func (r *SignalRedeployer) Configured() bool { return r.signalPath != "" }

// Trigger — writes the signal **atomically** (temp file + rename), so the sidecar can never
// read a half-written signal. The payload is a unix timestamp: the sidecar upgrades on any
// change to the file, and pressing the button again writes a fresh timestamp — a repeated,
// idempotent "go pull the latest and recreate". The app never names a version here; the
// compose's channel tag decides which image the sidecar pulls, keeping version policy in one
// place instead of split between the app and the deploy.
func (r *SignalRedeployer) Trigger(_ context.Context) error {
	if !r.Configured() {
		return ErrRedeployNotConfigured
	}
	tmp := r.signalPath + ".tmp"
	payload := []byte(strconv.FormatInt(r.now().Unix(), 10) + "\n")
	if err := os.WriteFile(tmp, payload, signalPerm); err != nil {
		return fmt.Errorf("write upgrade signal: %w", err)
	}
	if err := os.Rename(tmp, r.signalPath); err != nil {
		return fmt.Errorf("commit upgrade signal: %w", err)
	}
	return nil
}
