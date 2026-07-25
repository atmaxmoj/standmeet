// diag_connector.go —— POST /internal/diag/connector/{id}/{list-busy,create-event,send}
//
// Owner-authed diag：直接打某个连接器（按 id，不经 active 槽）跑一个品类契约 op，吐归一后的
// 结果。验上传连接器的 JSONata 绑定（response 抽取 / request 构造）端到端对不对——不经访客会话。

package sys

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/middleware"
)

// AgentCallFn —— 按 id 跑一个 agent-tool op（注入 auth 调 SaaS），回原始响应或错（diag 直验通路）。
type AgentCallFn func(
	ctx context.Context, id, ownerID, op string, args json.RawMessage,
) (json.RawMessage, error)

// DiagConnectorDeps —— 按 id 解析某连接器的品类契约（composition root 接 Slots）+ agent-tool 直调。
type DiagConnectorDeps struct {
	Calendar  func(id string) (contract.CalendarProxy, bool)
	Mail      func(id string) (contract.MailProxy, bool)
	AgentCall AgentCallFn
	Log       *slog.Logger
}

// MountDiagConnector —— 挂连接器 diag（caller 已套 owner-session 中间件）。
func MountDiagConnector(r chi.Router, deps DiagConnectorDeps) {
	r.Post("/diag/connector/{id}/list-busy", diagListBusy(deps))
	r.Post("/diag/connector/{id}/create-event", diagCreateEvent(deps))
	r.Post("/diag/connector/{id}/send", diagSend(deps))
	r.Post("/diag/connector/{id}/agent-call", diagAgentCall(deps))
}

type diagAgentCallReq struct {
	Op   string          `json:"op"`
	Args json.RawMessage `json:"args"`
}

// diagAgentCall —— owner 直跑一个 agent-tool（op）：注入 auth 调 SaaS，证运行时通路（§3 [A6]）。
// 成功 → 200 {ok:true}；运行失败 → 友好 200 {ok:false}（不泄底层，真错进日志）。
func diagAgentCall(deps DiagConnectorDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req diagAgentCallReq
		if !diagDecode(deps.Log, w, r, &req) {
			return
		}
		owner := middleware.OwnerIDFrom(r.Context())
		_, cerr := deps.AgentCall(r.Context(), chi.URLParam(r, "id"), owner, req.Op, req.Args)
		if cerr != nil {
			deps.Log.Warn("diag agent-call failed", "op", req.Op, "err", cerr)
			diagStatus(deps.Log, w, http.StatusOK, map[string]bool{"ok": false})
			return
		}
		diagStatus(deps.Log, w, http.StatusOK, map[string]bool{"ok": true})
	}
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
	Body    string `json:"text"` // 契约 body 的 plaintext（§8 mail 契约用 "text" 字段名）
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
	cal contract.CalendarProxy, req *diagRangeReq,
) {
	applyDefaultRange(req)
	tp, perr := parseTimePair(req.TimeMin, req.TimeMax)
	if perr != nil {
		diagStatus(log, w, http.StatusBadRequest, map[string]string{"error": "bad time range"})
		return
	}
	busy, ferr := cal.FreeBusy(ctx, middleware.OwnerIDFrom(ctx),
		contract.FreeBusyReq{TimeMin: tp.start, TimeMax: tp.end})
	if ferr != nil {
		diagCalErr(log, w, ferr)
		return
	}
	diagStatus(log, w, http.StatusOK, map[string][]diagInterval{"busy": toDiagIntervals(busy)})
}

// applyDefaultRange —— 时间窗都空则填 now..now+7d（诊断 list-busy 不强制传时间，让 SSRF /
// 连通性探测能不带 body 直接触发 FreeBusy）。
func applyDefaultRange(req *diagRangeReq) {
	if req.TimeMin != "" || req.TimeMax != "" {
		return
	}
	now := time.Now().UTC()
	req.TimeMin = now.Format(time.RFC3339)
	req.TimeMax = now.Add(7 * 24 * time.Hour).Format(time.RFC3339)
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

// rfc3339Millis —— 带毫秒（Go RFC3339 裁 .000 尾零；显式毫秒让忙时段忠实 round-trip）。
const rfc3339Millis = "2006-01-02T15:04:05.000Z07:00"

func toDiagIntervals(busy []contract.BusyInterval) []diagInterval {
	out := make([]diagInterval, 0, len(busy))
	for i := range busy {
		out = append(out, diagInterval{
			Start: busy[i].Start.Format(rfc3339Millis),
			End:   busy[i].End.Format(rfc3339Millis),
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
	cal contract.CalendarProxy, req *diagEventReq,
) {
	tp, perr := parseTimePair(req.Start, req.End)
	if perr != nil {
		diagStatus(log, w, http.StatusBadRequest, map[string]string{"error": "bad time"})
		return
	}
	ev, cerr := cal.InsertEvent(ctx, middleware.OwnerIDFrom(ctx), &contract.InsertEventReq{
		Summary: req.Title, Start: tp.start, End: tp.end, VisitorEmail: req.Attendee,
	})
	if cerr != nil {
		diagCalErr(log, w, cerr)
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

type diagSendResp struct {
	ViaKind string `json:"via_kind,omitempty"`
	Reason  string `json:"reason,omitempty"`
	Ok      bool   `json:"ok"`
}

// mailFailReason —— 发信失败的友好措辞（不泄 provider 原始错/状态码/stack；§8 mail 降级）。
const mailFailReason = "the mail could not be sent — the provider rejected it or is unavailable"

func diagRunSend(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter,
	mail contract.MailProxy, req *diagSendReq,
) {
	serr := mail.Send(ctx, middleware.OwnerIDFrom(ctx),
		contract.MailMessage{To: req.To, Subject: req.Subject, Body: req.Body})
	if serr != nil { // provider 拒/挂 → 友好降级（200 + ok:false），真错进日志
		log.Warn("diag mail send failed", "err", serr)
		diagStatus(log, w, http.StatusOK, diagSendResp{Ok: false, Reason: mailFailReason})
		return
	}
	diagStatus(log, w, http.StatusOK, diagSendResp{Ok: true, ViaKind: mailKind(mail)})
}

// mailKind —— 报连接器 kind（openapi / protocol）；消费者经契约发信，diag 借此证「mailer 不知 kind」。
func mailKind(m contract.MailProxy) string {
	if k, ok := m.(interface{ Kind() string }); ok {
		return k.Kind()
	}
	return ""
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

// calErrCase —— 日历契约错 → 友好 HTTP 状态（都 <500，不暴露 5xx/stack）。sentinel 都带干净
// 消息（BlockedEgress 不回显内网 URL；Unavailable 限流/瞬时；BadRequest 缺必填等）。
type calErrCase struct {
	match  error
	status int
}

var calErrCases = []calErrCase{
	{contract.ErrCalendarBlockedEgress, http.StatusBadRequest},
	{contract.ErrCalendarUnavailable, http.StatusOK}, // 限流/瞬时 → 友好降级（可退避，不崩）
	{contract.ErrCalendarBadRequest, http.StatusBadRequest},
}

// diagCalErr —— 日历契约调用失败：已知 sentinel → 友好 <500 带干净原因；其余上游故障 → 502。
func diagCalErr(log *slog.Logger, w http.ResponseWriter, err error) {
	for i := range calErrCases {
		if errors.Is(err, calErrCases[i].match) {
			diagStatus(log, w, calErrCases[i].status, map[string]string{"error": err.Error()})
			return
		}
	}
	diagFail(log, w, err)
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
