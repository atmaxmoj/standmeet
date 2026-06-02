// summary.go —— POST /api/v1/sessions/{id}/summary。同步调 AI 生成对话报告，
// 落 conversations.summary_md + ended_at，返 markdown body。session 之后
// 不能再发 message（visitor_chat enforceTurnQuota 校验 EndedAt → 410）。
//
// BYOAI tier 同 chat：browser 在 X-BYOAI-Provider + X-BYOAI-Key headers 把
// 信封过的 key 带过来，server 解封即用即丢。session 不缓存 key。

package public

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func (h *Handlers) postSummary() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runPostSummary(h, w, r)
	}
}

func runPostSummary(h *Handlers, w http.ResponseWriter, r *http.Request) {
	in, ok := prepareSummaryInput(h, w, r)
	if !ok {
		return
	}
	summary, err := usecases.GenerateSummary(r.Context(), &h.Visitor, in)
	if err != nil {
		handleVisitorErr(h.Log, w, err)
		return
	}
	writeSummary(h.Log, w, summary)
}

func prepareSummaryInput(
	h *Handlers, w http.ResponseWriter, r *http.Request,
) (*usecases.GenerateSummaryInput, bool) {
	av, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return nil, false
	}
	cred, byoaiOK := summaryBYOAICred(h, w, r, av.Data.Mode, av.Token)
	if !byoaiOK {
		return nil, false
	}
	return &usecases.GenerateSummaryInput{
		OwnerID:        av.Data.OwnerID,
		ConversationID: chi.URLParam(r, "id"),
		Mode:           av.Data.Mode,
		BYOAI:          cred,
	}, true
}

// summaryBYOAICred —— byoai tier 时调 readBYOAICredFromHeaders；non-byoai
// 返 nil + ok=true。
func summaryBYOAICred(
	h *Handlers, w http.ResponseWriter, r *http.Request,
	tier, sessionToken string,
) (*domain.AICredential, bool) {
	if tier != "byoai" {
		return nil, true
	}
	return readBYOAICredFromHeaders(h, w, r, sessionToken)
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
