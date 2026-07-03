// inference_usage.go —— #106 计费:GET /inference-usage 出 owner 近 7 天 LLM 用量
// (按天×model 聚合 + 合计)。数据由 postgres.InferenceUsageRepo.Summarize7Day 提供。

package admin

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
)

// InferenceUsageSummarizer —— #106 admin 计费面板数据源。
type InferenceUsageSummarizer interface {
	Summarize7Day(ctx context.Context, ownerID string) ([]domain.InferenceUsageDay, error)
}

type usageRowResp struct {
	Date         string `json:"date"`
	Model        string `json:"model"`
	Calls        int64  `json:"calls"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
}

type usageResp struct {
	Rows  []usageRowResp `json:"rows"`
	Total usageTotalResp `json:"total"`
}

type usageTotalResp struct {
	Calls        int64 `json:"calls"`
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}

func (h *Handlers) getInferenceUsage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		days, err := h.Usage.Summarize7Day(r.Context(), ownerID)
		if err != nil {
			logEncodeErr(h.Log, "inference usage", err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(toUsageResp(days)); eerr != nil {
			logEncodeErr(h.Log, "encode inference usage", eerr)
		}
	}
}

func toUsageResp(days []domain.InferenceUsageDay) usageResp {
	rows := make([]usageRowResp, 0, len(days))
	var total usageTotalResp
	for i := range days {
		rows = append(rows, usageRowResp{
			Date:         days[i].Day.Format("2006-01-02"),
			Model:        days[i].Model,
			Calls:        days[i].Calls,
			InputTokens:  days[i].InputTokens,
			OutputTokens: days[i].OutputTokens,
		})
		total.Calls += days[i].Calls
		total.InputTokens += days[i].InputTokens
		total.OutputTokens += days[i].OutputTokens
	}
	return usageResp{Rows: rows, Total: total}
}
