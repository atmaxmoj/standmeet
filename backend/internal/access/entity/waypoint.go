// waypoint.go — the ghost-steering waypoint type + its algebra (merge / validation /
// feasibility filtering).
//
// Pulled out of role_snapshot.go: the snapshot is "the role state frozen for a session",
// while the waypoint merge rule (role (+) code) is a separate topic, unrelated to the
// corpus/skill/capability freeze logic.

package entity

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// Waypoint — one ghost-steering guidance destination (the owner writes it on a role, a
// code can inherit/override it, frozen into RoleSnapshot). Field order follows
// fieldalignment: two strings first, slice in the middle, int/bool last.
type Waypoint struct {
	WaypointID   string   `json:"waypoint_id"`
	Description  string   `json:"description"`
	EvidenceRefs []string `json:"evidence_refs"`
	Weight       int      `json:"weight"`
	IsTerminal   bool     `json:"is_terminal"`
}

// MergeWaypoints — a code's waypoints layer over the role's: same waypoint_id -> the code
// overrides the whole entry, a new id -> appended. A role is the destinations for "this
// audience", a code is for "this one invite" — a hiring code that wants to add a
// destination unique to this occasion, or bump one entry's weight, on top of a generic
// role should not be forced to copy the entire list.
//
// Role order is preserved (stable, easy for the owner to compare against), the code's new
// entries are appended after. An empty override returns the role's list as-is.
//
// This function **only merges**: authorization filtering still happens uniformly through
// FilterWaypointsByCorpus at freeze time — a code can never use an override to steer
// toward evidence the role cannot see (an override never loosens the authorization floor).
func MergeWaypoints(base, override []Waypoint) []Waypoint {
	if len(override) == 0 {
		return base
	}
	byID := map[string]Waypoint{}
	for _, w := range override {
		byID[w.WaypointID] = w
	}
	ov := overlayOnto(base, byID)
	return append(ov.merged, newOverrides(override, ov.overriddenIDs)...)
}

// overlaid — the multi-return bundle for overlayOnto (same as partitionedVault: avoids a
// named return / the result-count limit).
type overlaid struct {
	overriddenIDs map[string]bool // fieldalignment: map (1 ptr) first, slice (3 ptr) after
	merged        []Waypoint
}

// overlayOnto — walks the role's list once: swap in the code's entry for a matching id,
// leave the rest as-is.
func overlayOnto(base []Waypoint, byID map[string]Waypoint) overlaid {
	out := make([]Waypoint, 0, len(base)+len(byID))
	overridden := map[string]bool{}
	for _, w := range base {
		if ov, ok := byID[w.WaypointID]; ok {
			out = append(out, ov)
			overridden[w.WaypointID] = true
			continue
		}
		out = append(out, w)
	}
	return overlaid{merged: out, overriddenIDs: overridden}
}

// newOverrides — the entries in code that role does not have (kept in code's own written
// order, appended after).
func newOverrides(override []Waypoint, overridden map[string]bool) []Waypoint {
	out := make([]Waypoint, 0, len(override))
	for _, w := range override {
		if !overridden[w.WaypointID] {
			out = append(out, w)
		}
	}
	return out
}

// ErrWaypointEmptyID — waypoint_id is the key for merge (MergeWaypoints), the visited mark
// (ledger), and ghost attribution; leaving it empty collapses that whole set of semantics,
// which is why it's the one hard requirement.
var ErrWaypointEmptyID = errors.New("each waypoint needs an id")

// ErrWaypointDuplicateID — two ids collide within the same list -> merge has no way to
// decide who overrides whom.
var ErrWaypointDuplicateID = errors.New("waypoint ids must be unique")

// ValidateWaypoints — shape validation for owner-written waypoints (shared by both the
// role surface and the code-override surface). description/weight/evidence_refs may all be
// empty: a waypoint with no evidence is still a valid destination (FilterWaypointsByCorpus
// admits it, the prompt's EVIDENCE rule then decides whether to offer it), an empty weight
// just means weight 0.
func ValidateWaypoints(ws []Waypoint) error {
	seen := map[string]bool{}
	for i := range ws {
		id := strings.TrimSpace(ws[i].WaypointID)
		if id == "" {
			return ErrWaypointEmptyID
		}
		if seen[id] {
			return fmt.Errorf("%w: %s", ErrWaypointDuplicateID, id)
		}
		seen[id] = true
	}
	return nil
}

// cloneWaypoints — a deep copy (evidence_refs slices are cloned too), to prevent mutation
// after freezing.
func cloneWaypoints(in []Waypoint) []Waypoint {
	if len(in) == 0 {
		return []Waypoint{}
	}
	out := make([]Waypoint, len(in))
	for i, w := range in {
		out[i] = w
		out[i].EvidenceRefs = slices.Clone(w.EvidenceRefs)
	}
	return out
}

// FilterWaypointsByCorpus — the **authorization** floor (called at freeze time): drops a
// waypoint whose evidence_refs fall entirely outside the authorized glob — a role should
// never be steered toward evidence it cannot see. A waypoint with no refs (e.g. a booking
// terminal, driven by a tool event rather than corpus) is kept; >=1 ref inside the
// boundary -> the whole entry is kept (the policy side only ever cites the visible ones).
//
// This function used to be called "feasibility floor", and it never did that job: a glob
// judges whether **this string** falls inside the boundary — `subjectivity://standpoint`
// matches `subjectivity://*` perfectly, while the note it points at can simply not exist.
// A waypoint like that is permanently unreachable (the ledger only marks visited by
// resolving the URI through a reference), and a ghost would push it forever. Feasibility
// is guarded separately by feasibleWaypoints on the conversation side (F-A-26) — two
// different things, two different names.
func FilterWaypointsByCorpus(waypoints []Waypoint, granted []string) []Waypoint {
	out := make([]Waypoint, 0, len(waypoints))
	for _, w := range waypoints {
		if len(w.EvidenceRefs) == 0 || anyRefAllowed(granted, w.EvidenceRefs) {
			out = append(out, w)
		}
	}
	return out
}

func anyRefAllowed(granted, refs []string) bool {
	for _, ref := range refs {
		if MatchesAnyCorpusGlob(granted, ref) {
			return true
		}
	}
	return false
}
