// waypoint_ledger.go —— ghost-steering P2: WaypointLedger 的机械化 visited 标记(α≈0,无 LLM 判官)。
//
// 一轮收尾调:本轮 assistant 的引用(cited note id)解析成 URI,命中冻结 waypoint 的 evidence_refs
// → 标 visited;终点能力(如约成)命中 → 标 terminal waypoint visited。ledger 挂 redis visitor_session
// (VisitedWaypoints)。变了才存盘;best-effort —— 失败只 warn,绝不压这轮答复。
//
// id→URI 解析复用 crawl-face 的 syncNotePath/dbParentOf(与检索 ACL 同口径,URI 一致)。

package usecases

import (
	"context"
	"log/slog"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/session"
)

// WaypointLedgerDeps —— cited id → URI 解析(VaultSync)+ session 存盘。
type WaypointLedgerDeps struct {
	Notes    *corpus.VaultSyncRepo
	Sessions *session.VisitorSessionStore
	Log      *slog.Logger
}

// WaypointLedger —— 可注入的 ledger marker,闭住 postgres note repo + session store。
// composition root 建一个喂 public Handlers —— route 层不碰 postgres(守 arch:publicroutes 不依赖
// postgres)。route 每轮把本轮引用/终点命中交给 Mark。
type WaypointLedger struct {
	deps *WaypointLedgerDeps
}

// NewWaypointLedger —— composition root 用。
func NewWaypointLedger(
	notes *corpus.VaultSyncRepo, sessions *session.VisitorSessionStore, log *slog.Logger,
) *WaypointLedger {
	return &WaypointLedger{deps: &WaypointLedgerDeps{Notes: notes, Sessions: sessions, Log: log}}
}

// Mark —— 一轮收尾标 visited(委托 MarkWaypointsVisited)。
func (l *WaypointLedger) Mark(ctx context.Context, in *MarkWaypointsInput) {
	MarkWaypointsVisited(ctx, l.deps, in)
}

// MarkWaypointsInput —— 一轮的 ledger 输入。Data 传值(本地改 VisitedWaypoints 再存回)。
type MarkWaypointsInput struct {
	Token        string
	Data         session.VisitorSessionData
	CitedNoteIDs []string
	TerminalOK   bool
}

// MarkWaypointsVisited —— 见文件头。命中即标,变了才存盘。
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

// ledgerWaypoints —— 有 RoleSnapshot 且冻了 waypoints 才走 ledger（否则 ok=false，caller 跳过）。
func ledgerWaypoints(in *MarkWaypointsInput) ([]access.Waypoint, bool) {
	if in.Data.RoleSnapshot == nil {
		return []access.Waypoint{}, false
	}
	wps := in.Data.RoleSnapshot.Waypoints()
	return wps, len(wps) > 0
}

// markAll —— 引用命中 evidence_refs + 终点命中 → 标 visited。返 changed。
// in 提供 TerminalOK（走结构体不走裸 bool flag，避 control-coupling）。
func markAll(
	in *MarkWaypointsInput, waypoints []access.Waypoint, cited []string, visited *stringSet,
) bool {
	changed := markByCitation(waypoints, cited, visited)
	if in.TerminalOK {
		changed = markTerminals(waypoints, visited) || changed
	}
	return changed
}

// resolveURIs —— cited note id → genre://path URI(GetSyncNote + syncNotePath,与检索 ACL 同口径）。
// 解析不到的 id 跳过(best-effort)。
func (d *WaypointLedgerDeps) resolveURIs(
	ctx context.Context, ownerID string, ids []string,
) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		note, err := d.Notes.GetSyncNote(ctx, ownerID, id)
		if err != nil {
			continue
		}
		path := syncNotePath(note.Title, note.ParentID, dbParentOf(ctx, d.Notes, ownerID))
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

// stringSet —— 小集合,dedup 加入 + 有序输出(存盘稳定,守 session JSON 无谓 diff）。
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
