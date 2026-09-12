// bundle_gate_wire.go — the code → bundle → blocks lookup, wired to the registry.
//
// Two reads per assembly, both narrow: which bundle the code carries, then what is in it
// right now. Not cached — that is the entire point. `block-model.md` says unmount is
// immediate, and a cache is how "immediate" quietly becomes "within the TTL".

package blockwire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
)

// BundleGate — wires "what may this code use" to the owner's assembly.
//
// **Fails CLOSED, unlike the enable gate right next to it, and the asymmetry is
// deliberate.** A failed read of the enable gate returns "nothing is disabled", which
// over-exposes by at most what the owner already installed and granted. A failed read
// here has no such floor: answering "not bound" would hand the session the ROLE's grant
// instead, which is a different and possibly wider set than the bundle the owner
// actually chose. So a read failure reports "bound, to nothing" — the visitor gets no
// tools and the owner gets a log line, which is recoverable; the other way round is a
// visitor holding a recruiter code reading whatever the role happened to allow.
func BundleGate(d *deps.Runtime) {
	d.AgentSkills.SetBundleGate(
		func(ctx context.Context, ownerID, codeID string) (map[string]bool, bool) {
			bundleID, err := d.CodeRepo.BundleID(ctx, ownerID, codeID)
			if err != nil {
				d.Log.Warn("bundle gate: resolve code bundle",
					"err", err, "code", codeID)
				return map[string]bool{}, true
			}
			if bundleID == "" {
				// This code carries no bundle: the role ACL answers, exactly as before.
				return nil, false
			}
			members, merr := d.Assembly.Members(ctx, bundleID)
			if merr != nil {
				d.Log.Warn("bundle gate: read members", "err", merr, "bundle", bundleID)
				return map[string]bool{}, true
			}
			return asSet(members), true
		})
}

func asSet(ids []string) map[string]bool {
	out := make(map[string]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}
