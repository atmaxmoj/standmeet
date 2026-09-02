// enable_gate.go — the owner's "is this capability on or off" gate, wired to the capability
// registry.

package axiscap

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
)

// CapabilityEnableGate — Phase H: wires the owner-enable gate to the registry. During visitor
// assembly, the registry uses this to strip out any capability the owner disabled. DB error
// → fail-open (returning nil = everything on), to preserve availability and keep one failed
// read from blocking every capability.
func CapabilityEnableGate(d *deps.Runtime) {
	d.AgentSkills.SetEnableGate(func(ctx context.Context, ownerID string) map[string]bool {
		disabled, err := d.CapabilityRepo.DisabledSet(ctx, ownerID)
		if err != nil {
			d.Log.Warn("capability enable-gate load", "err", err, "owner", ownerID)
			return map[string]bool{}
		}
		return disabled
	})
}
