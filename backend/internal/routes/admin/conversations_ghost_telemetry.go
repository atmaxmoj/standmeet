// conversations_ghost_telemetry.go —— GET /api/admin/ghosts/telemetry 的 handler + view 类型。
// 从 conversations.go 拆出来守 max-lines 350 cap；ghost-steering 漏斗遥测是独立关注点，
// 跟 transcript 读模型无耦合。

package admin

import (
	"net/http"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

type waypointStatView struct {
	TargetWaypoint string  `json:"target_waypoint"`
	Shown          int64   `json:"shown"`
	Accepted       int64   `json:"accepted"`
	AcceptanceRate float64 `json:"acceptance_rate"`
}

type ghostTelemetryTotals struct {
	Shown          int64   `json:"shown"`
	Accepted       int64   `json:"accepted"`
	AcceptanceRate float64 `json:"acceptance_rate"`
}

type ghostTelemetryResp struct {
	Waypoints []waypointStatView   `json:"waypoints"`
	Totals    ghostTelemetryTotals `json:"totals"`
}

// ghostTelemetry —— GET /api/admin/ghosts/telemetry：owner 的 per-waypoint 漏斗（policy ghost
// shown vs accepted + acceptance_rate）+ 总计。silence rate 需 turn-total 数据（另源），此处未含。
func (h *Handlers) ghostTelemetry() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		stats, err := conversation.GhostTelemetry(r.Context(), &h.Conversations.Ghosts, ownerID)
		if err != nil {
			h.Log.Error("ghost telemetry", logErrKey, err)
			writeError(h.Log, w, apierr.Envelope{
				Status:  http.StatusInternalServerError,
				Code:    "internal",
				Message: "couldn't load telemetry",
			})
			return
		}
		writeJSON(h.Log, w, buildGhostTelemetryResp(stats))
	}
}

func buildGhostTelemetryResp(stats []conversation.GhostWaypointStat) ghostTelemetryResp {
	wps := make([]waypointStatView, 0, len(stats))
	var totShown, totAccepted int64
	for i := range stats {
		s := &stats[i]
		wps = append(wps, waypointStatView{
			TargetWaypoint: s.TargetWaypoint, Shown: s.Shown,
			Accepted: s.Accepted, AcceptanceRate: s.AcceptanceRate(),
		})
		totShown += s.Shown
		totAccepted += s.Accepted
	}
	totals := ghostTelemetryTotals{Shown: totShown, Accepted: totAccepted}
	if totShown > 0 {
		totals.AcceptanceRate = float64(totAccepted) / float64(totShown)
	}
	return ghostTelemetryResp{Waypoints: wps, Totals: totals}
}
