// realm.go — this session's private view of the one flat table.
//
// `architecture.md` names this: *"derive a realm — this session's private `tools`"*, and
// *"the registry is **never copied per session** — one flat table, divergence at
// lookup."* Both halves are load-bearing and they pull against each other. Per-session
// isolation is easy to get by giving every session a copy of everything, and that is
// exactly what not to do: then an owner's edit reaches nobody and memory grows with
// visitors. So there is one table, and this is the lookup where sessions diverge.
//
// **Every visitor-facing walk goes through here** — AssembleVisitorBundle,
// VisitorStates, VisitorPromptPartIDs, ComposeSystemPrompt — which is what makes each
// question below a single gate rather than four copies that drift. It is also what makes
// them LIVE: this runs on every call, so an owner's edit reaches a session already open,
// with no draining and no reload (`block-model.md`).
//
// Three questions, in order, and the order is not arbitrary:
//
//	bundle       does this code carry a bundle, and is the block in it? Absent from the
//	             bundle means ABSENT — undiscoverable, not visible-and-off.
//	owner switch did the owner turn it off?
//	dependency   is every seam it requires actually supplied?
//
// The one question NOT asked here is the role ACL: that is the mount package's
// (`mounted_gate.go`), because it also has to weigh `acl: always` and a frozen role
// snapshot. Asking it here too would put one judgement in two places.

package registry

import "context"

// enabledFibers — the fibers that live in this assembly's realm.
func (r *Registry) enabledFibers(ctx context.Context, in *AssembleInput) []Fiber {
	fibers := r.List()
	disabled := r.disabledSet(ctx, in)
	// The bundle, read NOW rather than frozen at issue: this is what makes removing a
	// block from a bundle bite a session that is already open (bundle_gate.go).
	members, bound := r.bundleMembers(ctx, in)
	out := make([]Fiber, 0, len(fibers))
	for _, c := range fibers {
		if r.inRealm(ctx, c, in, realmGates{disabled: disabled, members: members, bound: bound}) {
			out = append(out, c)
		}
	}
	return out
}

// realmGates — the two answers read once per assembly, carried to the per-fiber test. They are
// read outside the loop on purpose: both are one query each, and asking per fiber would turn
// one read into N, with the added hazard that two of them could disagree inside one walk.
type realmGates struct {
	disabled map[string]bool
	members  map[string]bool
	bound    bool
}

// inRealm — the three questions, in order, for one fiber. Split out of the loop because the
// loop was over the branching budget, and because "which questions decide membership" is the
// thing a reader comes to this file for.
func (r *Registry) inRealm(
	ctx context.Context, c Fiber, in *AssembleInput, g realmGates,
) bool {
	// A code that carries a bundle is granted exactly the bundle's contents — additive, and
	// absent means absent. A code that carries none falls through to the role ACL
	// downstream, unchanged.
	if g.bound && !g.members[c.ID()] {
		return false
	}
	// The single global gate = owner turned it off (disabled) AND every seam in Requires is
	// supplied (D-2).
	return !g.disabled[c.ID()] && r.depsConnected(ctx, c, in)
}

// disabledSet — the ids this owner has turned off (via the injected EnableGate). No gate
// installed / no owner context → empty (everything on).
//
// Fails OPEN, and the asymmetry with the bundle gate beside it is deliberate: a failed
// read here over-exposes by at most what the owner already installed and granted, while
// a failed bundle read has no such floor — it would hand the session the role's grant
// instead, which may be wider than the bundle the owner actually chose.
func (r *Registry) disabledSet(ctx context.Context, in *AssembleInput) map[string]bool {
	r.mu.RLock()
	gate := r.gate
	r.mu.RUnlock()
	if gate == nil || in == nil || in.OwnerID == "" {
		return map[string]bool{}
	}
	return gate(ctx, in.OwnerID)
}
