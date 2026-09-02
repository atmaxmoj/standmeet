// report.go —— GET /api/v1/report/{id}
//
// I.3: the read entry point for one chat report. The visitor browser's independent
// /report/[id] route fetches it; returns {id, conversation_id, html, created_at}.
//
// Auth: visitor session token (Bearer). session.owner_id must equal the report row's
// owner_id; if not, returns 404 (same envelope as not_found to avoid leaking whether
// the id exists).
//
// The owner-side standalone admin route is added in a later commit; this is visitor
// side only.

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

// fetchOwnedReport —— GetByID + an ownership check; invisible → ErrReportNotFound
// (bundled with not_found to avoid leaking id existence). #170 BOLA fix: checking
// owner_id alone isn't enough — on a single-owner instance every visitor shares the
// same owner, so an owner-only check would let any visitor read someone else's
// conversation-summary report just by knowing the id. Changed to check "the report's
// conversation belongs to **the requesting member**", so a visitor can only read
// reports for their own conversation.
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

// reportVisibleTo —— the report belongs to this owner and its conversation is owned
// by this member.
func reportVisibleTo(
	h *Handlers, r *http.Request, report *conversation.ChatReport, ownerID, memberID string,
) bool {
	return report.OwnerID == ownerID &&
		conversationOwnedByMember(h, r, ownerID, report.ConversationID, memberID)
}

// conversationOwnedByMember —— whether the member_id of the conversation
// report.ConversationID points to == the requester.
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
