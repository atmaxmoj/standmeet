// diag_connector.go —— POST /internal/diag/connector/{id}/{list-busy,create-event,send}
//
// Owner-authed diag：直接打某个连接器（按 id，不经 active 槽）跑一个品类契约 op，吐归一后的
// 结果。验上传连接器的 JSONata 绑定（response 抽取 / request 构造）端到端对不对——不经访客会话。

package sys

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// DiagConnectorDeps —— 按 id 解析某连接器的品类契约（composition root 接 connector.Slots）。
type DiagConnectorDeps struct {
	Calendar func(id string) (usecases.CalendarProxy, bool)
	Mail     func(id string) (usecases.MailProxy, bool)
	Log      *slog.Logger
}

// MountDiagConnector —— 挂连接器 diag（caller 已套 owner-session 中间件）。
func MountDiagConnector(r chi.Router, deps DiagConnectorDeps) {
	r.Post("/diag/connector/{id}/list-busy", diagListBusy(deps))
	r.Post("/diag/connector/{id}/create-event", diagCreateEvent(deps))
	r.Post("/diag/connector/{id}/send", diagSend(deps))
}

type diagRangeReq struct {
	TimeMin string `json:"timeMin"`
	TimeMax string `json:"timeMax"`
}

type diagInterval struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type diagEventReq struct {
	Title    string `json:"title"`
	Start    string `json:"start"`
	End      string `json:"end"`
	Attendee string `json:"attendee"`
}

type diagSendReq struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

func diagListBusy(deps DiagConnectorDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cal, ok := deps.Calendar(chi.URLParam(r, "id"))
		if !ok {
			diagNotFound(deps.Log, w)
			return
		}
		var req diagRangeReq
		if !diagDecode(deps.Log, w, r, &req) {
			return
		}
		diagRunListBusy(r.Context(), deps.Log, w, cal, &req)
	}
}

func diagRunListBusy(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter,
	cal usecases.CalendarProxy, req *diagRangeReq,
) {
	tp, perr := parseTimePair(req.TimeMin, req.TimeMax)
	if perr != nil {
		diagStatus(log, w, http.StatusBadRequest, map[string]string{"error": "bad time range"})
		return
	}
	busy, ferr := cal.FreeBusy(ctx, middleware.OwnerIDFrom(ctx),
		usecases.FreeBusyReq{TimeMin: tp.start, TimeMax: tp.end})
	if ferr != nil {
		diagFail(log, w, ferr)
		return
	}
	diagStatus(log, w, http.StatusOK, map[string][]diagInterval{"busy": toDiagIntervals(busy)})
}

// timePair —— 一对解析好的时间（function-result-limit ≤2，用结构体承载）。
type timePair struct {
	start time.Time
	end   time.Time
}

func parseTimePair(a, b string) (timePair, error) {
	start, serr := time.Parse(time.RFC3339, a)
	if serr != nil {
		return timePair{}, serr
	}
	end, eerr := time.Parse(time.RFC3339, b)
	if eerr != nil {
		return timePair{}, eerr
	}
	return timePair{start: start, end: end}, nil
}

// diagNotFound —— 连接器 id 未注册（未建 / 不是该品类）。
func diagNotFound(log *slog.Logger, w http.ResponseWriter) {
	diagStatus(log, w, http.StatusNotFound, map[string]string{"error": "connector not found"})
}

func toDiagIntervals(busy []usecases.BusyInterval) []diagInterval {
	out := make([]diagInterval, 0, len(busy))
	for i := range busy {
		out = append(out, diagInterval{
			Start: busy[i].Start.Format(time.RFC3339),
			End:   busy[i].End.Format(time.RFC3339),
		})
	}
	return out
}

func diagCreateEvent(deps DiagConnectorDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cal, ok := deps.Calendar(chi.URLParam(r, "id"))
		if !ok {
			diagNotFound(deps.Log, w)
			return
		}
		var req diagEventReq
		if !diagDecode(deps.Log, w, r, &req) {
			return
		}
		diagRunCreateEvent(r.Context(), deps.Log, w, cal, &req)
	}
}

func diagRunCreateEvent(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter,
	cal usecases.CalendarProxy, req *diagEventReq,
) {
	tp, perr := parseTimePair(req.Start, req.End)
	if perr != nil {
		diagStatus(log, w, http.StatusBadRequest, map[string]string{"error": "bad time"})
		return
	}
	ev, cerr := cal.InsertEvent(ctx, middleware.OwnerIDFrom(ctx), &usecases.InsertEventReq{
		Summary: req.Title, Start: tp.start, End: tp.end, VisitorEmail: req.Attendee,
	})
	if cerr != nil {
		diagFail(log, w, cerr)
		return
	}
	diagStatus(log, w, http.StatusOK, map[string]string{"id": ev.EventID, "url": ev.HTMLLink})
}

func diagSend(deps DiagConnectorDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		mail, ok := deps.Mail(chi.URLParam(r, "id"))
		if !ok {
			diagNotFound(deps.Log, w)
			return
		}
		var req diagSendReq
		if !diagDecode(deps.Log, w, r, &req) {
			return
		}
		diagRunSend(r.Context(), deps.Log, w, mail, &req)
	}
}

func diagRunSend(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter,
	mail usecases.MailProxy, req *diagSendReq,
) {
	serr := mail.Send(ctx, middleware.OwnerIDFrom(ctx),
		usecases.MailMessage{To: req.To, Subject: req.Subject, Body: req.Body})
	if serr != nil {
		diagFail(log, w, serr)
		return
	}
	diagStatus(log, w, http.StatusOK, map[string]bool{"ok": true})
}

// diagDecode —— 解 JSON body；坏 → 400 + false。
//
//nolint:forbidigo // 解任意 diag body，集中放行 interface{}
func diagDecode(log *slog.Logger, w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		diagStatus(log, w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return false
	}
	return true
}

// diagFail —— 契约调用失败 → 友好 502（diag 不暴露栈）。
func diagFail(log *slog.Logger, w http.ResponseWriter, err error) {
	log.Warn("diag connector op failed", "err", err)
	diagStatus(log, w, http.StatusBadGateway, map[string]string{"error": err.Error()})
}

//nolint:forbidigo // diag JSON 写出，集中放行 interface{}
func diagStatus(log *slog.Logger, w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Error("diag encode", "err", err)
	}
}
