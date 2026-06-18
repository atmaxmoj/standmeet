// report.go —— GET /api/v1/report/{id}
//
// I.3: 一份 chat report 的读取入口。visitor 浏览器 /report/[id] 独立路
// 由 fetch 这条；返 {id, conversation_id, html, created_at}。
//
// Auth: visitor session token (Bearer)。session.owner_id 必须等于 report
// 行的 owner_id；不等翻 404 (跟 not_found 同 envelope 避免确认 id 存在的
// 信息泄漏)。
//
// owner-side 独立 admin route 后续 commit 加；此处仅 visitor 侧。

package public

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

type reportResponse struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversation_id"`
	HTML           string `json:"html"`
	CreatedAt      string `json:"created_at"`
}

func (h *Handlers) getReport() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dispatchGetReport(h, w, r)
	}
}

func dispatchGetReport(h *Handlers, w http.ResponseWriter, r *http.Request) {
	av, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return
	}
	report, ferr := fetchOwnedReport(h, r, chi.URLParam(r, "id"), av.Data.OwnerID)
	if ferr != nil {
		handleReportErr(h, w, ferr)
		return
	}
	writeReport(h, w, &report)
}

// fetchOwnedReport —— GetByID + owner_id 校；不属于 session.owner 翻
// ErrReportNotFound (跟 not_found 同包，避免 id 存在性泄漏)。
func fetchOwnedReport(
	h *Handlers, r *http.Request, id, ownerID string,
) (domain.ChatReport, error) {
	report, err := h.Reports.GetByID(r.Context(), id)
	if err != nil {
		return domain.ChatReport{}, err
	}
	if report.OwnerID != ownerID {
		return domain.ChatReport{}, domain.ErrReportNotFound
	}
	return report, nil
}

func writeReport(h *Handlers, w http.ResponseWriter, report *domain.ChatReport) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	body := reportResponse{
		ID:             report.ID,
		ConversationID: report.ConversationID,
		HTML:           report.HTML,
		CreatedAt:      report.CreatedAt.Format(time.RFC3339),
	}
	if err := json.NewEncoder(w).Encode(body); err != nil {
		h.Log.Error("encode report", "err", err)
	}
}

func handleReportErr(h *Handlers, w http.ResponseWriter, err error) {
	if errors.Is(err, domain.ErrReportNotFound) {
		writeError(h.Log, w, reportNotFoundEnv())
		return
	}
	h.Log.Error("get report", "err", err)
	writeError(h.Log, w, serverErr())
}

func reportNotFoundEnv() apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusNotFound, Code: "not_found", Message: "report not found",
	}
}
