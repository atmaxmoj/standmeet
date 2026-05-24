// summary.go —— POST /api/v1/sessions/{id}/summary。同步调 AI 生成对话报告，
// 落 conversations.summary_md + ended_at，返 markdown body。session 之后
// 不能再发 message（visitor_chat enforceTurnQuota 校验 EndedAt → 410）。

package public

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/usecases"
)

func (h *Handlers) postSummary() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, ok := authVisitor(h, w, r)
		if !ok {
			return
		}
		in := &usecases.GenerateSummaryInput{
			OwnerID:        data.OwnerID,
			ConversationID: chi.URLParam(r, "id"),
			Tier:           data.Tier,
			BYOAIProvider:  data.BYOAIProvider,
			BYOAIKeyEnc:    data.BYOAIKeyEnc,
		}
		summary, err := usecases.GenerateSummary(r.Context(), &h.Visitor, in)
		if err != nil {
			handleVisitorErr(h.Log, w, err)
			return
		}
		writeSummary(h.Log, w, summary)
	}
}

type summaryResp struct {
	SummaryMD string `json:"summary_md"`
}

func writeSummary(log *slog.Logger, w http.ResponseWriter, md string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(summaryResp{SummaryMD: md}); err != nil {
		log.Error("encode summary", "err", err)
	}
}
