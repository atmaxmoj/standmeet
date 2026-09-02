// conversations_funnel.go — the outbound payload for ghost-steering telemetry.
//
// The MCP side used to be a bare array with no totals; the panel side had
// {waypoints, totals}. Now there's one payload.

package ops

import "github.com/atmaxmoj/standmeet/internal/conversation/entity"

// waypointFunnelOut — the funnel for one steering destination.
type waypointFunnelOut struct {
	TargetWaypoint string  `json:"target_waypoint"`
	Shown          int64   `json:"shown"`
	Accepted       int64   `json:"accepted"`
	AcceptanceRate float64 `json:"acceptance_rate"`
}

// funnelTotalsOut — all destinations summed.
type funnelTotalsOut struct {
	Shown          int64   `json:"shown"`
	Accepted       int64   `json:"accepted"`
	AcceptanceRate float64 `json:"acceptance_rate"`
}

// ghostFunnelOut — per-destination breakdown plus totals.
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
