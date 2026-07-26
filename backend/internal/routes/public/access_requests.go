// access_requests.go —— POST /api/v1/access-requests —— 访客无 code 留言。
// 不需要鉴权；body 校验失败返 400，handle 不存在返 404。

package public

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// AccessRequestsHandlers —— public access-request route 依赖。
type AccessRequestsHandlers struct {
	Reqs usecases.AccessRequestsDeps
	Log  *slog.Logger
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
		out, err := usecases.SubmitForOwner(
			r.Context(), h.Reqs, &usecases.SubmitAccessRequestInput{
				Name: req.Name, Org: req.Org,
				Email: req.Email, Message: req.Message,
			},
		)
		if err != nil {
			handleAccessRequestErr(h.Log, w, err)
			return
		}
		writeSubmitResp(h.Log, w, &out)
	}
}

func writeSubmitResp(log *slog.Logger, w http.ResponseWriter, a *access.AccessRequest) {
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
	if errors.Is(err, usecases.ErrEmptyField) {
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
