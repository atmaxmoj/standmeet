// booking_confirmation.go —— POST /api/v1/booking-confirmation
//
// #122: 访客约成后点确认卡 →「引用 session email / 透传现填地址 / 不发」。
// **AI 不参与**:访客点卡片 → 这条 HTTP → 确定性代码发 owner-SMTP 一封信。
// 前端只知道"这段对话里有笔 booking",不持 booking_id;后端按 session →
// conversation_id 自己定位最近一笔预约,校归属 + 一笔一次 + 收件人硬控。
//
//	body { conversation_id, email?, tz }
//	  - email 空 → 引用 session 上的 visitor email(没有 → 422)
//	  - email 非空 → 透传访客现填地址
//	  - tz       → 访客浏览器时区,正文时间按它渲

package public

import (
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

type bookingConfirmRequest struct {
	ConversationID string `json:"conversation_id"`
	Email          string `json:"email"`
	TZ             string `json:"tz"`
}

// bookingConfirmErrCases —— #122 专属错误码表(收件人/幂等/连接器)。
var bookingConfirmErrCases = []apierr.Case{
	{Match: domain.ErrBookingNotFound, Envelope: apierr.Envelope{
		Status: http.StatusNotFound, Code: "booking_not_found",
		Message: "no booking found for this conversation",
	}},
	{Match: usecases.ErrBookingNoRecipient, Envelope: apierr.Envelope{
		Status: http.StatusUnprocessableEntity, Code: "no_recipient",
		Message: "no email address to send the confirmation to",
	}},
	{Match: usecases.ErrBookingConfirmationSent, Envelope: apierr.Envelope{
		Status: http.StatusConflict, Code: "already_sent",
		Message: "confirmation already sent for this booking",
	}},
	{Match: usecases.ErrMailNotConfigured, Envelope: apierr.Envelope{
		Status: http.StatusServiceUnavailable, Code: "mail_not_configured",
		Message: "owner has not configured email yet",
	}},
}

func (h *Handlers) sendBookingConfirmation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		av, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		h.runSendBookingConfirmation(w, r, av)
	}
}

func (h *Handlers) runSendBookingConfirmation(
	w http.ResponseWriter, r *http.Request, av authedVisitor,
) {
	req, ok := h.decodeBookingConfirmReq(w, r)
	if !ok {
		return
	}
	err := usecases.SendBookingConfirmation(r.Context(), h.Confirm,
		&usecases.SendBookingConfirmationInput{
			OwnerID:        av.Data.OwnerID,
			ConversationID: req.ConversationID,
			CodeID:         av.Data.CodeID,
			Recipient:      req.Email,
			SessionEmail:   av.Data.Visitor.Email,
			TZ:             req.TZ,
		})
	if err != nil {
		h.handleBookingConfirmErr(w, err)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// decodeBookingConfirmReq —— 解 body + 校 conversation_id;不合法自己写错误响应,
// 返 ok=false 让 caller 早退(把校验分支挪出 handler 守 routes-cyclo ≤3)。
func (h *Handlers) decodeBookingConfirmReq(
	w http.ResponseWriter, r *http.Request,
) (bookingConfirmRequest, bool) {
	var req bookingConfirmRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return req, false
	}
	if req.ConversationID == "" {
		writeError(h.Log, w, envBadReq("conversation_id required"))
		return req, false
	}
	return req, true
}

func (h *Handlers) handleBookingConfirmErr(w http.ResponseWriter, err error) {
	env := apierr.Classify(err, bookingConfirmErrCases)
	if env.Status >= http.StatusInternalServerError {
		h.Log.Error("booking confirmation", "err", err)
	}
	writeError(h.Log, w, env)
}
