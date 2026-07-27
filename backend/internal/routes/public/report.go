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

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
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
	report, ferr := fetchOwnedReport(h, r, chi.URLParam(r, "id"), av.Data.OwnerID, av.Data.MemberID)
	if ferr != nil {
		handleReportErr(h, w, ferr)
		return
	}
	writeReport(h, w, &report)
}

// fetchOwnedReport —— GetByID + 归属校；不可见翻 ErrReportNotFound (跟 not_found 同包，
// 避免 id 存在性泄漏)。#170 BOLA fix：不只校 owner_id —— 单 owner 实例下所有访客同 owner，
// 只校 owner 会让任意访客凭 id 读到别人的对话摘要 report。改为校「report 的会话属于**发起
// 请求的 member**」，访客只能读自己会话的 report。
func fetchOwnedReport(
	h *Handlers, r *http.Request, id, ownerID, memberID string,
) (conversation.ChatReport, error) {
	report, err := h.Reports.GetByID(r.Context(), id)
	if err != nil {
		return conversation.ChatReport{}, err
	}
	if reportVisibleTo(h, r, &report, ownerID, memberID) {
		return report, nil
	}
	return conversation.ChatReport{}, conversation.ErrReportNotFound
}

// reportVisibleTo —— report 属于该 owner 且其会话由该 member 拥有。
func reportVisibleTo(
	h *Handlers, r *http.Request, report *conversation.ChatReport, ownerID, memberID string,
) bool {
	return report.OwnerID == ownerID &&
		conversationOwnedByMember(h, r, ownerID, report.ConversationID, memberID)
}

// conversationOwnedByMember —— report.ConversationID 指向的会话 member_id 是否 == 请求者。
func conversationOwnedByMember(
	h *Handlers, r *http.Request, ownerID, convID, memberID string,
) bool {
	chat, err := h.Visitor.Chats.GetChat(r.Context(), ownerID, convID)
	return err == nil && chat.MemberID != nil && *chat.MemberID == memberID
}

func writeReport(h *Handlers, w http.ResponseWriter, report *conversation.ChatReport) {
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
	if errors.Is(err, conversation.ErrReportNotFound) {
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
