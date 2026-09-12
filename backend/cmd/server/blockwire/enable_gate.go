// enable_gate.go — the owner's "is this block on or off" gate, wired to the block
// registry.

package blockwire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
)

// BlockEnableGate — Phase H: wires the owner-enable gate to the registry. During visitor
// assembly, the registry uses this to strip out any block the owner disabled. DB error
// → fail-open (returning nil = everything on), to preserve availability and keep one failed
// read from blocking every block.
func BlockEnableGate(d *deps.Runtime) {
	d.AgentSkills.SetEnableGate(func(ctx context.Context, ownerID string) map[string]bool {
		disabled, err := d.BlockEnableRepo.DisabledSet(ctx, ownerID)
		if err != nil {
			d.Log.Warn("block enable-gate load", "err", err, "owner", ownerID)
			return map[string]bool{}
		}
		return disabled
	})
}
