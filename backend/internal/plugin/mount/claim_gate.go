// claim_gate.go —— the "say it, then do it" declaration from a block's manifest,
// carried into the assembled result.
//
// The declaration lives in data (`claim_gate: {tool, phrases}`); the judgment happens in the
// kernel (inference/agent_claim_gate.go). This file just passes it across the boundary unchanged.
// Split out of mounted.go to keep it under the max-lines 350 ceiling.

package mount

import (
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// claimGateOf —— the condition declared in the manifest, turned into the assembly-side
// condition. Not declared (or declared incompletely) → nil, meaning this block does
// not gate claims: when it can't be judged, "don't gate" beats "gate wrongly" — the same
// trade-off as the quota declaration.
func claimGateOf(m *plugin.Manifest) *registry.ClaimGate {
	if !m.ClaimGate.Usable() {
		return nil
	}
	return &registry.ClaimGate{Tool: m.ClaimGate.Tool, Phrases: m.ClaimGate.Phrases}
}
