// bundle_gate.go — when a code carries a bundle, the bundle IS the grant.
//
// `docs/design/plugin/frontend.md` §3 replaces a subtractive ACL —
// `global ∧ role ∧ ¬code-deny`, three screens to answer one question — with an additive
// one: pick a bundle, read its list. This file is where that swap actually happens, and
// it is deliberately small, because the two properties it has to keep are both about
// *when* the question is asked rather than how.
//
//  1. **Live.** `block-model.md`: unmount is immediate — no draining, no timeout, no
//     asynchronous unmount. The gate is consulted inside `enabledFibers`, which every
//     visitor assembly walks, so removing a block from a bundle takes effect on the next
//     call of a session already open. A snapshot taken when the code was issued would
//     turn "the owner revokes access" into "the next visitor won't see it", which is
//     exactly useless to an owner revoking in a hurry.
//
//  2. **Additive, not subtractive.** A block absent from the bundle is absent from
//     `blocks[]` entirely — undiscoverable, not visible-and-off. That is the first
//     of the two locks the design insists stay distinct; the second (owner-disabled →
//     visible with a reason) is `EnableGate`'s, and this file must not touch it.
//
// A code with no bundle returns `bound=false` and nothing changes: the role ACL answers
// as it always did. That is what lets an instance that has never assembled a bundle
// behave exactly as before, and it is why this could be added without rewriting the 600
// specs that encode the old rule.

package registry

import "context"

// BundleGate — the blocks this session's code is bound to, right now.
//
// `bound` is the whole reason this returns two values. An empty member set and "this
// code carries no bundle" are opposite instructions — the first grants nothing, the
// second defers to the role — and a single nil map cannot tell them apart. That
// collapse is how an owner ends up with a bundle they emptied silently granting
// everything the role allows.
type BundleGate func(
	ctx context.Context, ownerID, codeID string,
) (members map[string]bool, bound bool)

// SetBundleGate — composition root injects the bundle resolver.
func (r *Registry) SetBundleGate(g BundleGate) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.bundleGate = g
}

// bundleMembers — this assembly's bundle contents, or bound=false.
//
// No gate, no owner, or no code → not bound. The API-key path and the anonymous path
// both arrive with no code id, and neither has a bundle to read; answering "bound to an
// empty bundle" there would silently strip every tool from surfaces that never opted
// into this model.
//
// Resolved once per assembly and cached on the input. Two things read the answer — this
// package's `enabledFibers` and the mount package's exposure gate — and asking twice would
// mean two database reads that can disagree with each other inside one walk, which is a
// visitor seeing a tool listed and then told it does not exist.
func (r *Registry) bundleMembers(
	ctx context.Context, in *AssembleInput,
) (map[string]bool, bool) {
	if in == nil {
		return map[string]bool{}, false
	}
	if in.bundleDone {
		return in.bundleMembers, in.bundleBound
	}
	in.bundleDone = true
	gate := r.bundleGateFor(in)
	if gate == nil {
		return map[string]bool{}, false
	}
	in.bundleMembers, in.bundleBound = gate(ctx, in.OwnerID, in.Subject.ID)
	return in.bundleMembers, in.bundleBound
}

// bundleGateFor — the gate to ask, or nil when this assembly has no bundle to read.
//
// Three ways there is nothing to read, and they collapse to one answer here: no gate wired,
// no owner context, or a subject that is not a code. Only the code path carries a bundle — a
// key is a different subject with its own grant story, and reading a bundle off it would mean
// inventing one.
func (r *Registry) bundleGateFor(in *AssembleInput) BundleGate {
	r.mu.RLock()
	gate := r.bundleGate
	r.mu.RUnlock()
	if gate == nil || in.OwnerID == "" {
		return nil
	}
	if in.Subject.Kind != SubjectCode || in.Subject.ID == "" {
		return nil
	}
	return gate
}

// BundleGrant — the answer BundleGrants gives. A struct rather than two bools, because two
// bools of the same type at one call site is how `granted` and `bound` eventually get read in
// the wrong order — and reading them the wrong way round turns "this code carries no bundle"
// into "this code's bundle grants nothing", which is the one confusion the pair exists to
// prevent.
type BundleGrant struct {
	// Granted — is this block in the bundle. Meaningless unless Bound.
	Granted bool
	// Bound — does this code carry a bundle at all. false means fall back to the role's
	// grant; it does NOT mean denied.
	Bound bool
}

// BundleGrants — does this session's bundle grant this block, and is there one at all?
//
// The exposure gate lives in the mount package (it also has to weigh `acl: always` and
// the role snapshot), so it needs the answer this package resolved. Exported as a
// question rather than as the map: a caller holding the map would be free to interpret
// "absent" its own way, and "absent means denied" versus "absent means fall back to the
// role" is the entire distinction `Bound` exists to carry.
func (in *AssembleInput) BundleGrants(blockID string) BundleGrant {
	if in == nil || !in.bundleBound {
		return BundleGrant{}
	}
	return BundleGrant{Granted: in.bundleMembers[blockID], Bound: true}
}
