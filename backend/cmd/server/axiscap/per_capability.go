// per_capability.go — the "this capability's own stuff" handed to inbound convergence: its
// isolated storage and its config.
//
// Constructed on the capability-axis side, not on the convergence side: which namespace it's
// bound to is **the capability axis's own knowledge** — convergence only gathers the ops
// handed up from everywhere and dispatches them.

package axiscap

import (
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/routes/hostdesk"
)

// PerCapabilityDeps — a capability's **own** storage and config.
//
// Storage is bound to this capability's namespace at construction time (schema = mcp_<id>),
// so the sandbox side can never fill in someone else's table. Whether to provision is decided
// in exactly one place, needsStorage — see storage.go.
func PerCapabilityDeps(d *deps.Runtime, m *mcpplugin.Manifest) *hostdesk.PerCapability {
	per := &hostdesk.PerCapability{}
	store := CapabilityStorage(d, m)
	if store == nil {
		return per
	}
	if wantsAny(m, "capstore.") {
		per.Store = boundCapStore{store: store, kind: capstore.KindMCP, id: m.ID}
	}
	if len(m.Config) > 0 {
		per.Config = boundCapConfig{cfg: CapConfigFor(store, m.ID), decl: m.Config}
	}
	return per
}
