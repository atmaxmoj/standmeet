// capreg_claim_gate.go —— the "say it, then do it" declaration from a capability's manifest,
// carried into the assembled result.
//
// The declaration lives in data (`claim_gate: {tool, phrases}`); the judgment happens in the
// kernel (inference/agent_claim_gate.go). This file just passes it across the boundary unchanged.
// Split out of capreg_mcp_app.go to keep it under the max-lines 350 cap.

package capload

import (
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// claimGateOf —— the condition declared in the manifest, turned into the assembly-side
// condition. Not declared (or declared incompletely) → nil, meaning this capability does
// not gate claims: when it can't be judged, "don't gate" beats "gate wrongly" — the same
// trade-off as the quota declaration.
func claimGateOf(m *mcpplugin.Manifest) *capreg.ClaimGate {
	if !m.ClaimGate.Usable() {
		return nil
	}
	return &capreg.ClaimGate{Tool: m.ClaimGate.Tool, Phrases: m.ClaimGate.Phrases}
}
