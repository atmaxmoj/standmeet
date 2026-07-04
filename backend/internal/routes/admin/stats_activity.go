// stats_activity.go —— GET /api/admin/stats/activity（ActivityTicker 近期活动流）。自成 domain。

package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
)

// ActivityProvider —— 近期活动流数据源（postgres ActivityRepo 实现）。
type ActivityProvider interface {
	RecentActivity(ctx context.Context, ownerID string, limit int) ([]domain.ActivityEvent, error)
}

type activityEventResp struct {
	Kind  string `json:"kind"`
	At    string `json:"at"`
	Label string `json:"label"`
}

type activityResp struct {
	Events []activityEventResp `json:"events"`
}

func (h *Handlers) getRecentActivity() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		limit := int(parseLimit(r.URL.Query().Get("limit")))
		events, err := h.Activity.RecentActivity(r.Context(), ownerID, limit)
		if err != nil {
			h.Log.Error("recent activity", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(toActivityResp(events)); eerr != nil {
			logEncodeErr(h.Log, "encode recent activity", eerr)
		}
	}
}

func toActivityResp(events []domain.ActivityEvent) activityResp {
	out := make([]activityEventResp, 0, len(events))
	for i := range events {
		out = append(out, activityEventResp{
			Kind:  events[i].Kind,
			At:    events[i].At.UTC().Format(time.RFC3339),
			Label: events[i].Label,
		})
	}
	return activityResp{Events: out}
}
