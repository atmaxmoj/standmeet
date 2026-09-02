// waypoint_ledger.go —— ghost-steering P2: WaypointLedger's mechanical visited marking
// (α≈0, no LLM judge).
//
// Called at the end of each turn: this turn's assistant citations (cited note id) are
// resolved into URIs, and a match against a frozen waypoint's evidence_refs → marks it
// visited; a hit on a terminal capability (e.g. a booking closed) → marks the terminal
// waypoint visited. The ledger lives on redis visitor_session (VisitedWaypoints). Only
// saves when something changed; best-effort —— a failure only warns, never blocks this
// turn's reply.
//
// id→URI resolution reuses crawl-face's corpus.SyncNotePath/corpus.DBParentOf (same
// convention as the retrieval ACL, URIs match up).

package usecase

import (
	"context"
	"log/slog"
	"slices"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// WaypointLedgerDeps —— cited id → URI resolution (VaultSync) + session persistence.
type WaypointLedgerDeps struct {
	Notes    *corpus.VaultSyncRepo
	Sessions *access.VisitorSessionStore
	Log      *slog.Logger
}

// WaypointLedger —— an injectable ledger marker that closes over the postgres note
// repo + session store. The composition root builds one and feeds it to public
// Handlers —— the route layer never touches postgres (keeps the architecture rule that
// publicroutes doesn't depend on postgres). Each turn, the route hands this turn's
// citations/terminal hits to Mark.
type WaypointLedger struct {
	deps *WaypointLedgerDeps
}

// NewWaypointLedger —— for use by the composition root.
func NewWaypointLedger(
	notes *corpus.VaultSyncRepo, sessions *access.VisitorSessionStore, log *slog.Logger,
) *WaypointLedger {
	return &WaypointLedger{deps: &WaypointLedgerDeps{Notes: notes, Sessions: sessions, Log: log}}
}

// Mark —— marks visited at the end of a turn (delegates to MarkWaypointsVisited).
func (l *WaypointLedger) Mark(ctx context.Context, in *MarkWaypointsInput) {
	MarkWaypointsVisited(ctx, l.deps, in)
}

// MarkWaypointsInput —— one turn's ledger input. Data is passed by value (mutated
// locally, VisitedWaypoints updated, then saved back).
type MarkWaypointsInput struct {
	Token        string
	CitedNoteIDs []string
	Data         access.VisitorSessionData
	TerminalOK   bool
}

// MarkWaypointsVisited —— see file header. Marks on any hit, saves only if something
// changed.
func MarkWaypointsVisited(ctx context.Context, deps *WaypointLedgerDeps, in *MarkWaypointsInput) {
	waypoints, ok := ledgerWaypoints(in)
	if !ok {
		return
	}
	visited := newStringSet(in.Data.VisitedWaypoints)
	cited := deps.resolveURIs(ctx, in.Data.OwnerID, in.CitedNoteIDs)
	if !markAll(in, waypoints, cited, visited) {
		return
	}
	in.Data.VisitedWaypoints = visited.sorted()
	if err := deps.Sessions.Save(ctx, in.Token, &in.Data); err != nil {
		deps.Log.Warn("waypoint ledger save", "err", err)
	}
}

// ledgerWaypoints —— only proceeds through the ledger when there's a RoleSnapshot with
// frozen waypoints (otherwise ok=false, the caller skips it).
func ledgerWaypoints(in *MarkWaypointsInput) ([]access.Waypoint, bool) {
	if in.Data.RoleSnapshot == nil {
		return []access.Waypoint{}, false
	}
	wps := in.Data.RoleSnapshot.Waypoints()
	return wps, len(wps) > 0
}

// markAll —— citation hits on evidence_refs + terminal hits → marks visited. Returns
// changed. TerminalOK comes from `in` (passed via a struct, not a bare bool flag, to
// avoid control-coupling).
func markAll(
	in *MarkWaypointsInput, waypoints []access.Waypoint, cited []string, visited *stringSet,
) bool {
	changed := markByCitation(waypoints, cited, visited)
	if in.TerminalOK {
		changed = markTerminals(waypoints, visited) || changed
	}
	return changed
}

// resolveURIs —— cited note id → genre://path URI (GetSyncNote + corpus.SyncNotePath,
// same convention as the retrieval ACL). Ids that don't resolve are skipped
// (best-effort).
func (d *WaypointLedgerDeps) resolveURIs(
	ctx context.Context, ownerID string, ids []string,
) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		note, err := d.Notes.GetSyncNote(ctx, ownerID, id)
		if err != nil {
			continue
		}
		path := corpus.SyncNotePath(
			note.Title, note.ParentID, corpus.DBParentOf(ctx, d.Notes, ownerID),
		)
		out = append(out, corpus.FormatURI(corpus.DocumentGenre(note.Genre), path))
	}
	return out
}

func markByCitation(waypoints []access.Waypoint, citedURIs []string, visited *stringSet) bool {
	changed := false
	for i := range waypoints {
		if visited.has(waypoints[i].WaypointID) {
			continue
		}
		if anyRefIn(waypoints[i].EvidenceRefs, citedURIs) {
			visited.add(waypoints[i].WaypointID)
			changed = true
		}
	}
	return changed
}

func markTerminals(waypoints []access.Waypoint, visited *stringSet) bool {
	changed := false
	for i := range waypoints {
		if waypoints[i].IsTerminal && !visited.has(waypoints[i].WaypointID) {
			visited.add(waypoints[i].WaypointID)
			changed = true
		}
	}
	return changed
}

func anyRefIn(refs, cited []string) bool {
	for _, ref := range refs {
		if slices.Contains(cited, ref) {
			return true
		}
	}
	return false
}

// stringSet —— a small set with dedup-on-add + sorted output (stable persistence,
// avoids gratuitous diffs in the session JSON).
type stringSet struct{ m map[string]bool }

func newStringSet(init []string) *stringSet {
	s := &stringSet{m: make(map[string]bool, len(init))}
	for _, v := range init {
		s.m[v] = true
	}
	return s
}

func (s *stringSet) has(v string) bool { return s.m[v] }
func (s *stringSet) add(v string)      { s.m[v] = true }

func (s *stringSet) sorted() []string {
	out := make([]string, 0, len(s.m))
	for v := range s.m {
		out = append(out, v)
	}
	slices.Sort(out)
	return out
}
