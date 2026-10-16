// agent_turn_usage.go —— what a visitor turn spent, recorded at its end (#106). Split out of
// agent_turn.go along its own concern: billing, not running the turn. The write itself
// (turnUsageRecorder.record) stays in agent_turn.go, the one place it reaches the stats domain.

package public

import "github.com/atmaxmoj/standmeet/internal/conversation/inference"

// buildAgentTurnUsage —— #106 billing: usage port injected into inference. At the end of an
// owner-key turn, records accumulated tokens into inference_usage (scoped to owner_id).
// BYOAI is visitor-paid, so it returns nil. best-effort: a recording failure only warns.
func buildAgentTurnUsage(h *Handlers, auth authedVisitor) inference.RecordUsageFunc {
	if !usageBillable(h, auth) {
		return nil
	}
	rec := turnUsageRecorder{
		h: h, ownerID: auth.Data.OwnerID, providerID: auth.Data.ProviderID,
		feature: turnFeature(auth),
		// metered —— counts against some gas tank only if both switches are on: the role
		// has a tank attached and this turn resolves to a provider. Also gates cleanup
		// sweep-away — clear a metered row too early and the gas grows back on its own.
		metered: auth.Data.GasMetered && auth.Data.ProviderID != "",
	}
	return rec.record
}

// turnUsageRecorder —— the handful of things a turn's billing needs to close over (whose
// it is, which tank, and whether it counts as gas spend).
type turnUsageRecorder struct {
	h          *Handlers
	ownerID    string
	providerID string
	feature    string
	metered    bool
}

// turnFeature —— a visitor turn is billed to its role: 'chat:<role>' (instance.models names the
// same features).
func turnFeature(auth authedVisitor) string {
	if auth.Data.RoleSnapshot == nil {
		return "chat:"
	}
	return "chat:" + auth.Data.RoleSnapshot.RoleName()
}

// usageBillable —— #106: only owner-key turns are billed (BYOAI is visitor-paid / not
// billed when there's no recorder).
func usageBillable(h *Handlers, auth authedVisitor) bool {
	return h.Usage != nil && auth.Data.Mode != "byoai"
}
