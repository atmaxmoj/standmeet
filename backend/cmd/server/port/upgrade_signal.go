// upgrade_signal.go — the **product-owned** redeploy path.
//
// The webhook Redeployer (upgrade.go) needs the owner to paste an orchestrator URL, which
// most self-hosters can't produce — so the upgrade button is dead by default. This path
// removes that requirement: the product ships an updater sidecar (infra/updater), and the
// app signals it by writing to a file on a volume they share. The sidecar — the only
// container holding docker access — watches that file and pulls + recreates the stack.
//
// The app stays **docker.sock-free**: it writes a byte to a file, nothing more. All host
// privilege stays in the one small sidecar, off the internet-facing surface. can_apply is
// true out of the box because the sidecar ships with the compose and sets the signal path.

package port

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"
)

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
// composition root falls back to the webhook path or reports the button can't act.
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
