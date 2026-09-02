// visitor_waypoint_feasible.go —— the **feasibility** floor for frozen waypoints (F-A-26).
//
// The gate sitting next to this one (access.FilterWaypointsByCorpus) handles
// **authorization**: whether this role's glob can even see this piece of evidence. The
// two have always shared the name "feasibility floor," but only the former was ever
// implemented —— so a ref like `subjectivity://standpoint` could match its glob
// perfectly while pointing at a note that doesn't exist at all, and slip right through.
//
// Why this is worse than "a bad recommendation": WaypointLedger marks visited by taking
// the notes actually cited this turn, building their URIs from (genre, tree path), and
// matching against evidence_refs. A ref pointing at nothing will never be built by any
// citation, so that waypoint is **permanently unreachable** —— the ghost re-proposes it
// every turn as "not yet visited," and "everything's visited, go quiet" can never happen
// for this role. The design doc [[ghost-steering]] justifies this gate exactly on the
// grounds that "a ghost pointing where the corpus is thin steers the conversation into a
// failure."
//
// Terminal (is_terminal) waypoints are exempt: they're marked visited by a tool event
// (a booking closed), not by citation, so whether the evidence resolves has no bearing
// on their reachability. Filtering out a booking terminal would silence the whole
// conversion path.
//
// "Zero refs written" isn't handled here: that category is governed by the
// require_ghost_evidence switch, and whether it's on is the owner's choice.

package usecase

import (
	"context"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// CorpusRefResolver —— "does this evidence_ref resolve to a real note."
//
// Only asks about existence, never admission —— admission is the neighboring gate's job.
// Implemented in the corpus domain (corpus.RefResolver), reusing the same finder the
// agent itself uses to read the corpus, so "resolves" and "can actually be cited" are
// the same thing.
type CorpusRefResolver interface {
	ResolvesRef(ctx context.Context, ownerID, uri string) bool
}

// feasibleWaypoints —— drops any waypoint that's "non-terminal, and none of whose
// evidence_refs resolve to a real note."
//
// resolver is nil (an assembly that hasn't wired the read port yet) → returned
// unchanged: this layer shouldn't silence all of the owner's steering just because it
// can't read the corpus. Whether it's actually wired is covered by the
// ghost-waypoint-resolvable e2e.
func feasibleWaypoints(
	ctx context.Context, resolver CorpusRefResolver, ownerID string, in []access.Waypoint,
) []access.Waypoint {
	if resolver == nil {
		return in
	}
	out := make([]access.Waypoint, 0, len(in))
	for i := range in {
		if waypointReachable(ctx, resolver, ownerID, &in[i]) {
			out = append(out, in[i])
		}
	}
	return out
}

// waypointReachable —— a terminal is always reachable (closed by a tool event); the
// rest either have no refs written (handled by the require_ghost_evidence switch), or
// have at least one ref that resolves to something real.
func waypointReachable(
	ctx context.Context, resolver CorpusRefResolver, ownerID string, w *access.Waypoint,
) bool {
	if w.IsTerminal || len(w.EvidenceRefs) == 0 {
		return true
	}
	for _, ref := range w.EvidenceRefs {
		if resolver.ResolvesRef(ctx, ownerID, ref) {
			return true
		}
	}
	return false
}
