// res_conversations_funnel.go —— ghost-steering 遥测的出站载荷。
//
// MCP 那份以前只有一个裸数组,没有总计;面板那份有 {waypoints, totals}。一份载荷。

package dispatcher

// WaypointFunnel —— 一个引导目的地的漏斗。
type WaypointFunnel struct {
	TargetWaypoint string  `json:"target_waypoint"`
	Shown          int64   `json:"shown"`
	Accepted       int64   `json:"accepted"`
	AcceptanceRate float64 `json:"acceptance_rate"`
}

// FunnelTotals —— 全部目的地加起来。
type FunnelTotals struct {
	Shown          int64   `json:"shown"`
	Accepted       int64   `json:"accepted"`
	AcceptanceRate float64 `json:"acceptance_rate"`
}

// GhostFunnel —— 逐个目的地 + 总计。
type GhostFunnel struct {
	Waypoints []WaypointFunnel `json:"waypoints"`
	Totals    FunnelTotals     `json:"totals"`
}
