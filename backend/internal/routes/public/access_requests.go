// access_requests.go —— POST /api/v1/access-requests —— 访客无 code 留言。
// 不需要鉴权；body 校验失败返 400，handle 不存在返 404。

package public

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// RequestGuard —— 留言口的 per-IP 闸（实现在 infra/middleware）。窄接口:这一层只问
// 「拦不拦」「记一笔」，captcha 和 redis 都藏在边界之后，跟 CodeGuard 同一个规矩。
type RequestGuard interface {
	Locked(ctx context.Context, ip, captchaToken string) bool
	// HasLift —— 被拦下的人此刻有没有一条自己走得通的出路（captcha 开着才有）。
	// 拒绝那句话按它选词，否则它会去描述一个屏幕上不存在的控件。
	HasLift() bool
	RecordSubmit(ctx context.Context, ip string)
}

// AccessRequestsHandlers —— public access-request route 依赖。
type AccessRequestsHandlers struct {
	Reqs  access.RequestsDeps
	Guard RequestGuard
	Log   *slog.Logger
}

// Mount 挂 POST /access-requests。caller 负责前缀。
func (h *AccessRequestsHandlers) Mount(r chi.Router) {
	r.Post("/access-requests", h.submit())
}

type submitRequestBody struct {
	Name    string `json:"name"`
	Org     string `json:"org"`
	Email   string `json:"email"`
	Message string `json:"message"`
	// CaptchaToken —— 超过阈值之后放行用的那张票。跟码兑换同一个形状（F-G-4）。
	CaptchaToken string `json:"captcha_token,omitempty"`
}

type submitRequestResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func (h *AccessRequestsHandlers) submit() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req submitRequestBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		h.guardedSubmit(w, r, &req)
	}
}

// guardedSubmit —— 闸 → 写 → 记账。这个口子不鉴权，而它写进的是 owner 一条条亲手读的
// 队列，所以量本身就是信号（F-G-4）。
func (h *AccessRequestsHandlers) guardedSubmit(
	w http.ResponseWriter, r *http.Request, req *submitRequestBody,
) {
	ip := clientIP(r)
	if h.Guard.Locked(r.Context(), ip, req.CaptchaToken) {
		writeError(h.Log, w, h.floodEnvelope())
		return
	}
	out, err := access.SubmitForOwner(
		r.Context(), h.Reqs, &access.SubmitAccessRequestInput{
			Name: req.Name, Org: req.Org,
			Email: req.Email, Message: req.Message,
		},
	)
	if err != nil {
		handleAccessRequestErr(h.Log, w, err)
		return
	}
	// **成功也计**：这里数的是量不是错误。留言没有对错，多才是信号。
	h.Guard.RecordSubmit(r.Context(), ip)
	writeSubmitResp(h.Log, w, &out)
}

// floodEnvelope —— 说哪一句，取决于这台实例此刻给不给得出那条出路（跟码兑换同一条规矩）。
func (h *AccessRequestsHandlers) floodEnvelope() apierr.Envelope {
	if h.Guard.HasLift() {
		return envRequestFloodCaptcha()
	}
	return envRequestFloodWait()
}

// envRequestFloodWait / envRequestFloodCaptcha —— 「这里发得太多了」的两句话。
// 光说「稍后再试」会让一个真有话要说的人以为自己被永久拒之门外；而 captcha 关着的部署里
// 根本没有校验可解，那时说「过一次人机校验」就是在指一个不存在的控件。
func envRequestFloodWait() apierr.Envelope {
	return requestFlood("too many notes from here — try again in a few minutes")
}

func envRequestFloodCaptcha() apierr.Envelope {
	return requestFlood(
		"too many notes from here — clear the human check and this one goes through",
	)
}

func requestFlood(msg string) apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusTooManyRequests, Code: "request_flood", Message: msg,
	}
}

func writeSubmitResp(log *slog.Logger, w http.ResponseWriter, a *access.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	resp := submitRequestResponse{ID: a.ID, Status: a.Status}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode access request resp", "err", err)
	}
}

func handleAccessRequestErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := classifyAccessRequestErr(err)
	if env.Status >= http.StatusInternalServerError {
		log.Error("access request submit", "err", err)
	}
	writeError(log, w, env)
}

func classifyAccessRequestErr(err error) apierr.Envelope {
	if errors.Is(err, apierr.ErrEmptyField) {
		return apierr.Envelope{
			Status: http.StatusBadRequest, Code: "bad_request", Message: "missing required field",
		}
	}
	if errors.Is(err, owner.ErrOwnerNotFound) {
		return apierr.Envelope{
			Status:  http.StatusNotFound,
			Code:    "owner_not_found",
			Message: "instance not yet claimed",
		}
	}
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}
