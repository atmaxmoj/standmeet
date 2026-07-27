// stats_activity.go —— GET /api/admin/stats/activity（ActivityTicker 近期活动流）。自成 domain。

package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// ActivityProvider —— 近期活动流 + 语料链接图数据源（postgres ActivityRepo 实现）。
type ActivityProvider interface {
	RecentActivity(ctx context.Context, ownerID string, limit int) ([]stats.ActivityEvent, error)
	CorpusGraph(ctx context.Context, ownerID string, limit int) ([]stats.GraphNode, error)
}

type graphNodeResp struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Genre  string `json:"genre"`
	Degree int    `json:"degree"`
}

type graphResp struct {
	Nodes []graphNodeResp `json:"nodes"`
}

func (h *Handlers) getCorpusGraph() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		limit := int(parseLimit(r.URL.Query().Get("limit")))
		nodes, err := h.Activity.CorpusGraph(r.Context(), ownerID, limit)
		if err != nil {
			h.Log.Error("corpus graph", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(toGraphResp(nodes)); eerr != nil {
			logEncodeErr(h.Log, "encode corpus graph", eerr)
		}
	}
}

func toGraphResp(nodes []stats.GraphNode) graphResp {
	out := make([]graphNodeResp, 0, len(nodes))
	for i := range nodes {
		out = append(out, graphNodeResp{
			ID: nodes[i].ID, Title: nodes[i].Title, Genre: nodes[i].Genre, Degree: nodes[i].Degree,
		})
	}
	return graphResp{Nodes: out}
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

func toActivityResp(events []stats.ActivityEvent) activityResp {
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
