// visitor_waypoint_feasible.go —— 冻结 waypoints 的**可行性**下限(F-A-26)。
//
// 跟它并排的那道闸(access.FilterWaypointsByCorpus)管的是**授权**:这个 role 的 glob 看不看得见
// 这条证据。两件事一直共用「feasibility floor」这个名字,而只有前者被实现过 —— 于是一条
// `subjectivity://standpoint` 之类的 ref,glob 匹配得完美无缺,指向的笔记却根本不存在,就这么
// 穿了过去。
//
// 为什么它比「推荐得不好」严重:WaypointLedger 标 visited 的办法,是拿本轮真被引用的笔记按
// (genre, 树路径) 拼出 URI 再比对 evidence_refs。一条指向空的 ref 永远不会被任何引用拼出来,
// 所以那条 waypoint **永久不可访** —— ghost 每轮都把它当「还没去过」重新推一遍,而「全都去过了
// 就转静默」在这个 role 上永远不会发生。设计文档 [[ghost-steering]] 给这道闸的依据正是
// "a ghost pointing where the corpus is thin steers the conversation into a failure"。
//
// 终点(is_terminal)豁免:它靠工具事件(约成)标 visited,不靠引用,所以证据解不解析得出都不影响
// 它可达。把预约终点滤掉会让整条转化路径静音。
//
// 「一条 ref 都没写」不在这里管:那一类由 require_ghost_evidence 那个开关管,开不开是 owner 的选择。

package usecase

import (
	"context"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// CorpusRefResolver —— 「这条 evidence_ref 指得到一条真笔记吗」。
//
// 只问存在性,不问准入 —— 准入是隔壁那道闸的事。实现在 corpus 域(corpus.RefResolver),
// 复用 agent 自己读语料用的那套 finder,好让「解析得出」跟「真能被引用」是同一件事。
type CorpusRefResolver interface {
	ResolvesRef(ctx context.Context, ownerID, uri string) bool
}

// feasibleWaypoints —— 丢掉「非终点、且 evidence_refs 一条都解析不出真笔记」的 waypoint。
//
// resolver 为 nil(还没接读口的装配)→ 原样返回:这一层不该因为读不到语料就把 owner 的引导
// 全部静音。接没接上由 ghost-waypoint-resolvable 那条 e2e 兜。
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

// waypointReachable —— 终点永远可达(工具事件闭合);其余要么没写 refs(交给 require_ghost_evidence
// 那个开关),要么至少有一条 ref 指得到真东西。
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
