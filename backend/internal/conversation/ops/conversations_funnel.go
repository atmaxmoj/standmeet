// conversations_funnel.go —— ghost-steering 遥测的出站载荷。
//
// MCP 那份以前只有一个裸数组,没有总计;面板那份有 {waypoints, totals}。一份载荷。

package ops

import "github.com/atmaxmoj/standmeet/internal/conversation/entity"

// waypointFunnelOut —— 一个引导目的地的漏斗。
type waypointFunnelOut struct {
	TargetWaypoint string  `json:"target_waypoint"`
	Shown          int64   `json:"shown"`
	Accepted       int64   `json:"accepted"`
	AcceptanceRate float64 `json:"acceptance_rate"`
}

// funnelTotalsOut —— 全部目的地加起来。
type funnelTotalsOut struct {
	Shown          int64   `json:"shown"`
	Accepted       int64   `json:"accepted"`
	AcceptanceRate float64 `json:"acceptance_rate"`
}

// ghostFunnelOut —— 逐个目的地 + 总计。
type ghostFunnelOut struct {
	Waypoints []waypointFunnelOut `json:"waypoints"`
	Totals    funnelTotalsOut     `json:"totals"`
}

func toGhostFunnel(stats []entity.GhostWaypointStat) ghostFunnelOut {
	wps := make([]waypointFunnelOut, 0, len(stats))
	var shown, accepted int64
	for i := range stats {
		s := &stats[i]
		wps = append(wps, waypointFunnelOut{
			TargetWaypoint: s.TargetWaypoint, Shown: s.Shown,
			Accepted: s.Accepted, AcceptanceRate: s.AcceptanceRate(),
		})
		shown += s.Shown
		accepted += s.Accepted
	}
	totals := funnelTotalsOut{Shown: shown, Accepted: accepted}
	if shown > 0 {
		totals.AcceptanceRate = float64(accepted) / float64(shown)
	}
	return ghostFunnelOut{Waypoints: wps, Totals: totals}
}
