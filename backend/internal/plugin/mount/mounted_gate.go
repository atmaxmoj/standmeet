// mounted_gate.go — may this block speak in this session?
//
// Split out of mounted.go, which is at the 350-line cap, and along a real seam rather
// than wherever the lines ran out: everything here answers one question, and the file it
// came from answers a different one (how a block is instantiated and dialled).
//
// Two gates, and keeping them apart is the design:
//
//	GRANT        is this block in what the visitor's code carries? A block that is not
//	             is ABSENT — undiscoverable, not visible-and-off.
//	FRAGMENT     does this block have anything to say in this particular session?
//	             (retrieval with no corpus scope has not.)
//
// A third gate — the owner's live off-switch — is deliberately NOT here. It lives in
// `registry.enabledBlocks`, because a block the owner switched off must stay **visible**
// with `enabled=false`, and folding it in here would make it vanish instead. An earlier
// draft of the design collapsed the two and lost the "installed but switched off" state
// entirely.

package mount

import (
	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// fragmentActive —— the fragmentGate predicate (retrieval: has a corpus scope). nil =
// always active. Controls prompt fragment contribution + FiberState.Enabled.
func (c *mcpAppFiber) fragmentActive(in *registry.AssembleInput) bool {
	return c.fragmentGate == nil || c.fragmentGate(in)
}

// fragmentVisible —— whether this block gets to speak in this session (granted +
// fragment active).
func (c *mcpAppFiber) fragmentVisible(in *registry.AssembleInput) bool {
	return c.granted(in) && c.fragmentActive(in)
}

// mcpAppGranted —— the ROLE's answer. ACL=always → exposed unconditionally to every mode
// (an externalized builtin base block, like ask_visitor). Otherwise role-granted:
// only exposed when the role's AllowedTools contains this plugin's ID (echoer /
// third-party server); no role (public/byoai) → hidden.
func mcpAppGranted(m *plugin.Manifest, snap *access.RoleSnapshot) bool {
	always := m.ACL == plugin.ACLAlways
	if snap == nil {
		return always // no snapshot: no code-deny source, so only always-blocks show
	}
	// The frozen three-tier judgment (the live gate is computed separately in enabledBlocks).
	// Code denies are included here.
	return snap.AllowsBlock(m.ID, always)
}

// granted —— the exposure gate, with the bundle taking precedence when there is one.
//
// A code bound to a bundle IS granted the bundle's contents; the role's `allowed_tools`
// and the per-code denials are the *other* model, and asking both would mean an owner
// who assembled a bundle still has to go and grant the same blocks on a role. The two
// stand side by side rather than merging: `BundleGrants` reports `Bound=false` for every
// code that carries none, and those keep the frozen three-tier judgment untouched —
// which is why the 600-odd specs encoding it stayed green through this change.
func (c *mcpAppFiber) granted(in *registry.AssembleInput) bool {
	if g := in.BundleGrants(c.m.ID); g.Bound {
		return g.Granted
	}
	return mcpAppGranted(&c.m, in.RoleSnapshot)
}
