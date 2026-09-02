// capreg_mcp_app_register.go —— turns a discovered manifest into a registered capability
// (split out of capreg_mcp_app.go to keep it under check-max-lines).
//
// This part is **assembly**: who enters the registry, with what origin, what happens on an
// ID collision, which capabilities are "exposed unconditionally". The neighboring file is
// **the capability's own behavior** (dialing, the exposure gate, state/prompt contribution).

package capload

import (
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// RegisterDiscoveredPlugins —— registers each discovered manifest as a mcpAppCapability
// into the same Registry, tagged with the given origin:
//   - OriginBuiltin: bundled builtins shipped with the product image (e.g. the externalized
//     ask_visitor). This source is also present in prod; the admin surface cannot delete it
//     (deleting = changing the image).
//   - OriginManaged: third-party/integration plugins installed at deploy time via the
//     STANDMEET_PLUGINS declaration.
//
// An ID collision (with another builtin or with each other) → that entry is skipped and
// collected into the returned skipped list (the caller logs it), so one bad plugin never
// panics the whole boot.
func RegisterDiscoveredPlugins(
	reg *capreg.Registry, manifests []mcpplugin.Manifest, origin capreg.Origin,
	dialErrLog func(id string, err error),
) []string {
	return RegisterDiscoveredPluginsHooked(reg, manifests, origin, nil, dialErrLog)
}

// RegisterDiscoveredPluginsHooked —— RegisterDiscoveredPlugins plus attaching per-session
// hooks (CapHooks) to a specific plugin ID. Injected by the composition root (that's where
// the connector proxy / store / corpus scope live): booker uses Gate for connector+quota
// tool hiding; retrieval uses Fragment for the corpus-scope prompt/enabled gate. hooks is
// nil / has no such ID → no extra hooks (the default).
func RegisterDiscoveredPluginsHooked(
	reg *capreg.Registry, manifests []mcpplugin.Manifest, origin capreg.Origin,
	hooks map[string]CapHooks, dialErrLog func(id string, err error),
) []string {
	skipped := []string{}
	always := []string{}
	for i := range manifests {
		c := hookedCap(&manifests[i], hooks, dialErrLog)
		if err := reg.RegisterOrigin(c, origin); err != nil {
			skipped = append(skipped, manifests[i].ID)
			continue
		}
		if manifests[i].ACL == mcpplugin.ACLAlways {
			always = append(always, manifests[i].ID)
		}
	}
	// Tell the registry which ids are "exposed unconditionally": the exposure gate reads the
	// manifest's ACL (`mcpAppGranted`), and **whether it can be attached to some role's
	// dock** asks the same question. Without handing this up, the registry could only treat
	// "what got registered" as the valid list, and a role could then accept a button it can
	// never actually produce (F-D-13).
	reg.SetAlwaysGranted(append(reg.AlwaysGranted(), always...))
	return skipped
}

// hookedCap —— the capability for one manifest, with the hooks the composition root gave
// it attached.
func hookedCap(
	m *mcpplugin.Manifest, hooks map[string]CapHooks, dialErrLog func(id string, err error),
) *mcpAppCapability {
	appCap := newMCPAppCapability(m)
	appCap.dialErrLog = dialErrLog
	if h, ok := hooks[m.ID]; ok {
		appCap.gate = h.Gate
		appCap.fragmentGate = h.Fragment
		appCap.stateHook = h.State
	}
	return appCap
}
