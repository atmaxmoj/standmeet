// claimgate.go — the "say it, then do it" condition on the assembly surface.
//
// A capability declares this in its own manifest (`claim_gate: {tool, phrases}`);
// assembly attaches it to the Binding and carries it out. The kernel checks it
// once at turn end (inference/agent_claim_gate.go): if the answer asserts the
// action completed, this turn must have a successful receipt from that tool.
// The assembly surface doesn't judge — it only carries the declaration.

package capreg

// ClaimGate — a capability's necessary condition: when the answer asserts the
// action completed, this turn must have a successful receipt from Tool.
type ClaimGate struct {
	Tool    string
	Phrases []string
}
