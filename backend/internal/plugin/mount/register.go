// register.go —— turns a discovered manifest into a registered block
// (split out of mounted.go to keep it under check-max-lines).
//
// This part is **assembly**: who enters the registry, with what origin, what happens on an
// ID collision, which blocks are "exposed unconditionally". The neighboring file is
// **the block's own behavior** (dialing, the exposure gate, state/prompt contribution).

package mount

import (
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// RegisterDiscoveredPlugins —— registers each discovered manifest as an mcpAppFiber
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
	reg *registry.Registry, manifests []plugin.Manifest, origin registry.Origin,
	dialErrLog func(id string, err error),
) []string {
	return RegisterDiscoveredPluginsHooked(reg, manifests, origin, nil, dialErrLog)
}

// RegisterDiscoveredPluginsHooked —— RegisterDiscoveredPlugins plus attaching per-session
// hooks (BlockHooks) to a specific plugin ID. Injected by the composition root (that's where
// the supplier proxy / store / corpus scope live): booker uses Gate for supplier+quota
// tool hiding; retrieval uses Fragment for the corpus-scope prompt/enabled gate. hooks is
// nil / has no such ID → no extra hooks (the default).
func RegisterDiscoveredPluginsHooked(
	reg *registry.Registry, manifests []plugin.Manifest, origin registry.Origin,
	hooks map[string]BlockHooks, dialErrLog func(id string, err error),
) []string {
	skipped := []string{}
	always := []string{}
	for i := range manifests {
		c := hookedFiber(&manifests[i], hooks, dialErrLog)
		if err := reg.RegisterOrigin(c, origin); err != nil {
			skipped = append(skipped, manifests[i].ID)
			continue
		}
		if manifests[i].ACL == plugin.ACLAlways {
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

// hookedFiber —— the fiber for one manifest, with the hooks the composition root gave
// it attached.
func hookedFiber(
	m *plugin.Manifest, hooks map[string]BlockHooks, dialErrLog func(id string, err error),
) *mcpAppFiber {
	fiber := newMCPAppFiber(m)
	fiber.dialErrLog = dialErrLog
	if h, ok := hooks[m.ID]; ok {
		fiber.gate = h.Gate
		fiber.fragmentGate = h.Fragment
		fiber.stateHook = h.State
	}
	return fiber
}
