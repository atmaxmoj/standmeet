// booking_cancellation.go —— POST /api/v1/booking-cancellation
//
// #123: 访客取消**自己约的**会议。body { event_id }(BookCard 上的 google_event_id)。
// 隔离全在 usecase:用 (session owner + code + member) 解析这笔 booking,不属于本
// member → ErrBookingNotFound → 404(不泄露存在性)。AI 不参与,访客点卡片 → 这条
// HTTP → 确定性删 GCal event + DB 行。

package public

import (
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/plugins/booker"
)

type bookingCancelRequest struct {
	EventID string `json:"event_id"`
}

// bookingCancelErrCases —— 隔离/不存在统一翻 404(不区分,避免存在性泄露)。
var bookingCancelErrCases = []apierr.Case{
	{Match: booker.ErrBookingNotFound, Envelope: apierr.Envelope{
		Status: http.StatusNotFound, Code: "booking_not_found",
		Message: "no booking found",
	}},
}

func (h *Handlers) cancelOwnBooking() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		av, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		h.runCancelOwnBooking(w, r, av)
	}
}

func (h *Handlers) runCancelOwnBooking(
	w http.ResponseWriter, r *http.Request, av authedVisitor,
) {
	req, ok := h.decodeBookingCancelReq(w, r)
	if !ok {
		return
	}
	_, err := booker.CancelOwnBooking(r.Context(), h.Cancel,
		&booker.CancelOwnBookingInput{
			OwnerID:  av.Data.OwnerID,
			CodeID:   av.Data.CodeID,
			MemberID: av.Data.MemberID,
			EventID:  req.EventID,
		})
	if err != nil {
		h.handleBookingCancelErr(w, err)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// decodeBookingCancelReq —— 解 body + 校 event_id;不合法自己写错误响应、返
// ok=false 让 caller 早退(把校验分支挪出 handler 守 routes-cyclo ≤3)。
func (h *Handlers) decodeBookingCancelReq(
	w http.ResponseWriter, r *http.Request,
) (bookingCancelRequest, bool) {
	var req bookingCancelRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return req, false
	}
	if req.EventID == "" {
		writeError(h.Log, w, envBadReq("event_id required"))
		return req, false
	}
	return req, true
}

func (h *Handlers) handleBookingCancelErr(w http.ResponseWriter, err error) {
	env := apierr.Classify(err, bookingCancelErrCases)
	if env.Status >= http.StatusInternalServerError {
		h.Log.Error("booking cancellation", "err", err)
	}
	writeError(h.Log, w, env)
}
