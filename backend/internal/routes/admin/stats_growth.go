// stats_growth.go —— GET /api/admin/stats/growth（SystemPulse 语料库脉搏）。自成 domain，
// 跟 system / activity / jobs 各一个 provider，不合并。

package admin

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
)

// GrowthProvider —— corpus 增长数据源（postgres GrowthRepo 实现）。
type GrowthProvider interface {
	CorpusGrowth(ctx context.Context, ownerID string) (domain.CorpusGrowth, error)
}

type dayCountResp struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

type tierCountsResp struct {
	Raw            int `json:"raw"`
	Wiki           int `json:"wiki"`
	Output         int `json:"output"`
	Writing        int `json:"writing"`
	RawUnprocessed int `json:"raw_unprocessed"`
}

type growthResp struct {
	Series  []dayCountResp `json:"series"`
	ByTier  tierCountsResp `json:"by_tier"`
	Total   int            `json:"total"`
	Delta7d int            `json:"delta_7d"`
}

func (h *Handlers) getCorpusGrowth() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		g, err := h.Growth.CorpusGrowth(r.Context(), ownerID)
		if err != nil {
			h.Log.Error("corpus growth", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(toGrowthResp(&g)); eerr != nil {
			logEncodeErr(h.Log, "encode corpus growth", eerr)
		}
	}
}

func toGrowthResp(g *domain.CorpusGrowth) growthResp {
	series := make([]dayCountResp, 0, len(g.Series))
	for i := range g.Series {
		series = append(series, dayCountResp{Day: g.Series[i].Day, Count: g.Series[i].Count})
	}
	return growthResp{
		Series: series,
		ByTier: tierCountsResp{
			Raw: g.ByTier.Raw, Wiki: g.ByTier.Wiki, Output: g.ByTier.Output,
			Writing: g.ByTier.Writing, RawUnprocessed: g.ByTier.RawUnprocessed,
		},
		Total:   g.Total,
		Delta7d: g.Delta7d,
	}
}
